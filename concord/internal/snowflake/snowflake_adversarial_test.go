package snowflake

import (
	"encoding/json"
	"errors"
	"math"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestAdversarial_MonotonicityAndRollover generates 10,000 IDs in a single thread
// to test sequence increments, millisecond transitions, and sequence rollover.
func TestAdversarial_MonotonicityAndRollover(t *testing.T) {
	gen, err := New(15, 15)
	if err != nil {
		t.Fatalf("failed to create generator: %v", err)
	}

	const totalIDs = 10000
	var prev ID = 0
	var rolloverCount int

	for i := 0; i < totalIDs; i++ {
		id, err := gen.NextID()
		if err != nil {
			t.Fatalf("NextID error at iteration %d: %v", i, err)
		}

		if id <= prev {
			t.Fatalf("monotonicity violation at index %d: current %d <= prev %d", i, id, prev)
		}

		seq := id.Sequence()
		if seq < 0 || seq > MaxSequence {
			t.Fatalf("sequence out of bounds [0, %d]: %d", MaxSequence, seq)
		}

		if i > 0 && seq == 0 {
			rolloverCount++
		}

		prev = id
	}

	t.Logf("Monotonicity verified for %d IDs across rollovers/ms changes (sequence resets: %d)", totalIDs, rolloverCount)
}

// TestAdversarial_HighConcurrencyStress executes 50 goroutines generating 2,000 IDs each
// (total 100,000 IDs) to stress test concurrent generation and detect any collision.
func TestAdversarial_HighConcurrencyStress(t *testing.T) {
	gen, err := New(10, 20)
	if err != nil {
		t.Fatalf("failed to create generator: %v", err)
	}

	const goroutines = 50
	const idsPerGoroutine = 2000
	const totalExpected = goroutines * idsPerGoroutine

	// Sharded maps to reduce sync.Map contention in test harness
	const shards = 16
	type shardMap struct {
		mu sync.Mutex
		m  map[ID]struct{}
	}
	mapShards := make([]shardMap, shards)
	for i := 0; i < shards; i++ {
		mapShards[i].m = make(map[ID]struct{}, totalExpected/shards)
	}

	var duplicateCount int64
	var totalGenerated int64
	var wg sync.WaitGroup

	startBarrier := make(chan struct{})

	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(workerIdx int) {
			defer wg.Done()
			<-startBarrier

			for j := 0; j < idsPerGoroutine; j++ {
				id, err := gen.NextID()
				if err != nil {
					t.Errorf("NextID error in goroutine %d: %v", workerIdx, err)
					return
				}

				shardIdx := uint64(id) % shards
				s := &mapShards[shardIdx]
				s.mu.Lock()
				if _, exists := s.m[id]; exists {
					atomic.AddInt64(&duplicateCount, 1)
					t.Errorf("DUPLICATE Snowflake ID detected: %d (worker %d, iter %d)", id, workerIdx, j)
				} else {
					s.m[id] = struct{}{}
					atomic.AddInt64(&totalGenerated, 1)
				}
				s.mu.Unlock()
			}
		}(g)
	}

	close(startBarrier)
	wg.Wait()

	if duplicateCount > 0 {
		t.Fatalf("concurrency stress failed: %d duplicate IDs detected!", duplicateCount)
	}

	if totalGenerated != int64(totalExpected) {
		t.Fatalf("expected %d total IDs, but recorded %d", totalExpected, totalGenerated)
	}

	t.Logf("Concurrency stress passed: successfully generated %d unique IDs without collision across %d goroutines", totalGenerated, goroutines)
}

// TestAdversarial_BitDistributionAndExtraction verifies exact bit layout and boundaries
func TestAdversarial_BitDistributionAndExtraction(t *testing.T) {
	// 1. Boundary checking for workerID and processID
	invalidPairs := [][2]int64{
		{-1, 0},
		{32, 0},
		{0, -1},
		{0, 32},
		{-100, 10},
		{10, 100},
	}
	for _, pair := range invalidPairs {
		_, err := New(pair[0], pair[1])
		if err == nil {
			t.Errorf("expected error for invalid IDs (w=%d, p=%d), got nil", pair[0], pair[1])
		}
	}

	// 2. Exact bit reconstruction across boundary worker & process IDs
	testCases := []struct {
		worker  int64
		process int64
	}{
		{0, 0},
		{31, 0},
		{0, 31},
		{31, 31},
		{1, 1},
		{16, 8},
	}

	for _, tc := range testCases {
		gen, err := New(tc.worker, tc.process)
		if err != nil {
			t.Fatalf("failed to create generator for w=%d, p=%d: %v", tc.worker, tc.process, err)
		}

		id, err := gen.NextID()
		if err != nil {
			t.Fatalf("failed to generate ID: %v", err)
		}

		raw := id.Int64()

		// Verify sign bit is 0 (positive 64-bit signed int)
		if raw < 0 {
			t.Errorf("Snowflake ID is negative (%d); sign bit must be 0", raw)
		}

		// Verify worker extraction
		if id.WorkerID() != tc.worker {
			t.Errorf("worker ID mismatch: expected %d, got %d", tc.worker, id.WorkerID())
		}

		// Verify process extraction
		if id.ProcessID() != tc.process {
			t.Errorf("process ID mismatch: expected %d, got %d", tc.process, id.ProcessID())
		}

		// Verify timestamp extraction
		expectedTimeApprox := time.Now().UTC()
		extractedTime := id.Time()
		diff := extractedTime.Sub(expectedTimeApprox).Abs()
		if diff > 2*time.Second {
			t.Errorf("extracted time %v differs from expected %v by %v", extractedTime, expectedTimeApprox, diff)
		}

		// Bit level isolation check
		extractedWorkerBits := (raw >> WorkerIDShift) & WorkerIDMask
		if extractedWorkerBits != tc.worker {
			t.Errorf("worker bits polluted: expected %d, got %d", tc.worker, extractedWorkerBits)
		}

		extractedProcessBits := (raw >> ProcessIDShift) & ProcessIDMask
		if extractedProcessBits != tc.process {
			t.Errorf("process bits polluted: expected %d, got %d", tc.process, extractedProcessBits)
		}
	}
}

// TestAdversarial_ClockDriftStress tests clock rollback handling and threshold rejection
func TestAdversarial_ClockDriftStress(t *testing.T) {
	gen, err := New(5, 5)
	if err != nil {
		t.Fatalf("failed to create generator: %v", err)
	}

	// 1. Within threshold: 25ms drift
	gen.mu.Lock()
	now := time.Now().UnixMilli() - ConcordEpoch
	gen.lastMs = now + 25
	gen.mu.Unlock()

	start := time.Now()
	id, err := gen.NextID()
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("expected successful recovery from 25ms drift, got: %v", err)
	}
	if id <= 0 {
		t.Errorf("expected positive ID, got %d", id)
	}
	if elapsed < 20*time.Millisecond {
		t.Logf("Note: clock catchup slept %v", elapsed)
	}

	// 2. Beyond threshold: > 5000ms drift
	gen.mu.Lock()
	now = time.Now().UnixMilli() - ConcordEpoch
	gen.lastMs = now + 5005
	gen.mu.Unlock()

	_, err = gen.NextID()
	if err == nil {
		t.Fatal("expected error for clock drift > 5000ms, got nil")
	}
	if !errors.Is(err, ErrClockDrift) {
		t.Errorf("expected ErrClockDrift, got: %v", err)
	}
}

// TestAdversarial_ClockDriftMonotonicity tests that after recovering from backward clock drift,
// the newly generated ID is STRICTLY GREATER than any ID generated before the drift occurred.
func TestAdversarial_ClockDriftMonotonicity(t *testing.T) {
	gen, err := New(1, 1)
	if err != nil {
		t.Fatalf("failed to create generator: %v", err)
	}

	gen.mu.Lock()
	now := time.Now().UnixMilli() - ConcordEpoch
	futureMs := now + 50
	gen.lastMs = futureMs
	gen.sequence = 100
	gen.mu.Unlock()

	// An ID previously generated at futureMs with sequence 100
	prevID := ID((futureMs << TimestampShift) | (gen.workerID << WorkerIDShift) | (gen.processID << ProcessIDShift) | 100)

	id, err := gen.NextID()
	if err != nil {
		t.Fatalf("NextID error: %v", err)
	}

	if id <= prevID {
		t.Fatalf("CRITICAL MONOTONICITY REGRESSION: ID after clock drift (%d, timestamp %d) is <= previous ID (%d, timestamp %d)",
			id, (int64(id) >> TimestampShift), prevID, futureMs)
	}
}

// TestAdversarial_JSONStringSerializationInvariant verifies the critical invariant
// that all Snowflake IDs are formatted as quoted JSON strings to prevent JS float rounding.
func TestAdversarial_JSONStringSerializationInvariant(t *testing.T) {
	// IEEE 754 float64 has 53 bits of mantissa: MAX_SAFE_INTEGER = 2^53 - 1 = 9007199254740991
	const maxSafeInteger = int64(1<<53 - 1)

	// An ID that safely exceeds 2^53 - 1
	largeID := ID(132521450388197376)
	if largeID.Int64() <= maxSafeInteger {
		t.Fatalf("test precondition failed: largeID %d is not > %d", largeID, maxSafeInteger)
	}

	// 1. Marshal directly
	marshaledBytes, err := json.Marshal(largeID)
	if err != nil {
		t.Fatalf("failed to marshal ID: %v", err)
	}
	rawJSON := string(marshaledBytes)

	// Invariant: MUST start and end with quote
	if rawJSON != `"132521450388197376"` {
		t.Fatalf("VIOLATION of JSON string invariant: expected quoted string %s, got: %s", `"132521450388197376"`, rawJSON)
	}

	// 2. Struct marshal test with pointers and values
	type ComplexModel struct {
		ID       ID   `json:"id"`
		ParentID *ID  `json:"parent_id,omitempty"`
		NullID   *ID  `json:"null_id"`
		ZeroID   ID   `json:"zero_id"`
	}

	parent := ID(132521450388197377)
	obj := ComplexModel{
		ID:       largeID,
		ParentID: &parent,
		NullID:   nil,
		ZeroID:   0,
	}

	objBytes, err := json.Marshal(obj)
	if err != nil {
		t.Fatalf("failed to marshal struct: %v", err)
	}
	objJSON := string(objBytes)

	expectedSubstring1 := `"id":"132521450388197376"`
	expectedSubstring2 := `"parent_id":"132521450388197377"`
	expectedSubstring3 := `"null_id":null`
	expectedSubstring4 := `"zero_id":"0"`

	for _, sub := range []string{expectedSubstring1, expectedSubstring2, expectedSubstring3, expectedSubstring4} {
		if !contains(objJSON, sub) {
			t.Errorf("struct JSON missing expected representation '%s'. Full JSON: %s", sub, objJSON)
		}
	}

	// 3. Unmarshaling robustness
	// a. From quoted string
	var unmarshaled ID
	if err := json.Unmarshal([]byte(`"132521450388197376"`), &unmarshaled); err != nil {
		t.Fatalf("failed to unmarshal quoted string: %v", err)
	}
	if unmarshaled != largeID {
		t.Errorf("unmarshaled mismatch: got %d, expected %d", unmarshaled, largeID)
	}

	// b. From unquoted numeric literal (backward compatibility)
	if err := json.Unmarshal([]byte(`132521450388197376`), &unmarshaled); err != nil {
		t.Fatalf("failed to unmarshal unquoted number: %v", err)
	}
	if unmarshaled != largeID {
		t.Errorf("unmarshaled numeric mismatch: got %d, expected %d", unmarshaled, largeID)
	}

	// c. From null
	if err := json.Unmarshal([]byte(`null`), &unmarshaled); err != nil {
		t.Fatalf("failed to unmarshal null: %v", err)
	}
	if unmarshaled != 0 {
		t.Errorf("unmarshaled null expected 0, got %d", unmarshaled)
	}

	// d. From empty string
	if err := json.Unmarshal([]byte(`""`), &unmarshaled); err != nil {
		t.Fatalf("failed to unmarshal empty string: %v", err)
	}
	if unmarshaled != 0 {
		t.Errorf("unmarshaled empty string expected 0, got %d", unmarshaled)
	}

	// e. Reject invalid strings
	invalidInputs := []string{
		`"not-a-number"`,
		`"9223372036854775808"`, // overflow int64 (MaxInt64 is 9223372036854775807)
		`" "`,
		`"123abc"`,
		`true`,
		`[1, 2]`,
	}
	for _, bad := range invalidInputs {
		var badID ID
		if err := json.Unmarshal([]byte(bad), &badID); err == nil {
			t.Errorf("expected error when unmarshaling invalid input %s, got nil (id=%d)", bad, badID)
		}
	}
}

// TestAdversarial_SQLScannerAdversarial tests database scanner resilience
func TestAdversarial_SQLScannerAdversarial(t *testing.T) {
	id := ID(132521450388197376)
	if val, err := id.Value(); err != nil || val != int64(132521450388197376) {
		t.Fatalf("id.Value() error or mismatch: %v, %v", val, err)
	}

	// Valid scans
	validInputs := []interface{}{
		int64(132521450388197376),
		int(132521450388),
		"132521450388197376",
		[]byte("132521450388197376"),
		nil,
	}

	for _, input := range validInputs {
		var sc ID
		if err := sc.Scan(input); err != nil {
			t.Errorf("Scan(%v [%T]) unexpected error: %v", input, input, err)
		}
	}

	// Invalid scans
	invalidInputs := []interface{}{
		math.Pi,
		true,
		"invalid-number",
		[]byte("not-an-int"),
		struct{}{},
	}

	for _, bad := range invalidInputs {
		var sc ID
		if err := sc.Scan(bad); err == nil {
			t.Errorf("expected error when scanning invalid input %v [%T], got nil", bad, bad)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 || (len(s) > 0 && len(substr) > 0 && findSubstr(s, substr)))
}

func findSubstr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
