package snowflake

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

func TestSnowflake_BasicGeneration(t *testing.T) {
	gen, err := New(1, 1)
	if err != nil {
		t.Fatalf("failed to create generator: %v", err)
	}

	id1, err := gen.NextID()
	if err != nil {
		t.Fatalf("failed to generate id1: %v", err)
	}

	id2, err := gen.NextID()
	if err != nil {
		t.Fatalf("failed to generate id2: %v", err)
	}

	if id1 >= id2 {
		t.Errorf("expected id2 (%d) > id1 (%d)", id2, id1)
	}

	if gen.workerID != id1.WorkerID() {
		t.Errorf("worker ID mismatch: expected %d, got %d", gen.workerID, id1.WorkerID())
	}

	if gen.processID != id1.ProcessID() {
		t.Errorf("process ID mismatch: expected %d, got %d", gen.processID, id1.ProcessID())
	}
}

func TestSnowflake_ConcurrentGeneration(t *testing.T) {
	gen, err := New(2, 3)
	if err != nil {
		t.Fatalf("failed to create generator: %v", err)
	}

	const goroutines = 20
	const idsPerGoroutine = 500
	idMap := sync.Map{}
	var wg sync.WaitGroup

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < idsPerGoroutine; j++ {
				id, err := gen.NextID()
				if err != nil {
					t.Errorf("NextID failed: %v", err)
					return
				}
				if _, loaded := idMap.LoadOrStore(id, true); loaded {
					t.Errorf("duplicate snowflake ID generated: %d", id)
					return
				}
			}
		}()
	}

	wg.Wait()
}

func TestSnowflake_JSONSerialization(t *testing.T) {
	type Sample struct {
		ID   ID   `json:"id"`
		Ref  ID   `json:"ref"`
		Null ID   `json:"null_id"`
	}

	id := ID(1762041600000123)
	sample := Sample{
		ID:  id,
		Ref: id,
	}

	data, err := json.Marshal(sample)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	expected := `{"id":"1762041600000123","ref":"1762041600000123","null_id":"0"}`
	if string(data) != expected {
		t.Errorf("expected JSON %s, got %s", expected, string(data))
	}

	// Test unmarshaling from string representation
	var unmarshaled Sample
	if err := json.Unmarshal([]byte(`{"id":"1762041600000123","ref":1762041600000123,"null_id":null}`), &unmarshaled); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if unmarshaled.ID != id {
		t.Errorf("expected unmarshaled ID %d, got %d", id, unmarshaled.ID)
	}
	if unmarshaled.Ref != id {
		t.Errorf("expected unmarshaled Ref %d, got %d", id, unmarshaled.Ref)
	}
	if unmarshaled.Null != 0 {
		t.Errorf("expected null_id to be 0, got %d", unmarshaled.Null)
	}
}

func TestSnowflake_SQLScannerAndValuer(t *testing.T) {
	id := ID(123456789012345)

	val, err := id.Value()
	if err != nil {
		t.Fatalf("Value() error: %v", err)
	}
	if val != int64(123456789012345) {
		t.Errorf("Value() mismatch: got %v", val)
	}

	var scanned ID
	if err := scanned.Scan(int64(123456789012345)); err != nil {
		t.Fatalf("Scan(int64) error: %v", err)
	}
	if scanned != id {
		t.Errorf("Scan(int64) mismatch: got %d, expected %d", scanned, id)
	}

	if err := scanned.Scan("123456789012345"); err != nil {
		t.Fatalf("Scan(string) error: %v", err)
	}
	if scanned != id {
		t.Errorf("Scan(string) mismatch: got %d, expected %d", scanned, id)
	}

	if err := scanned.Scan([]byte("123456789012345")); err != nil {
		t.Fatalf("Scan([]byte) error: %v", err)
	}
	if scanned != id {
		t.Errorf("Scan([]byte) mismatch: got %d, expected %d", scanned, id)
	}

	if err := scanned.Scan(nil); err != nil {
		t.Fatalf("Scan(nil) error: %v", err)
	}
	if scanned != 0 {
		t.Errorf("Scan(nil) expected 0, got %d", scanned)
	}
}

func TestSnowflake_ClockDriftMitigation(t *testing.T) {
	gen, err := New(0, 0)
	if err != nil {
		t.Fatalf("failed to create generator: %v", err)
	}

	// Artificially move lastMs into the future by 50ms (simulating small backward drift)
	gen.mu.Lock()
	now := time.Now().UnixMilli() - ConcordEpoch
	gen.lastMs = now + 50
	gen.mu.Unlock()

	id, err := gen.NextID()
	if err != nil {
		t.Fatalf("expected clock drift <= 5000ms to recover, got error: %v", err)
	}
	if id <= 0 {
		t.Errorf("invalid id generated: %d", id)
	}
}
