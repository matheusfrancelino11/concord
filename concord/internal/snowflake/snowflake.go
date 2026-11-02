package snowflake

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"
)

const (
	// ConcordEpoch represents Nov 1, 2026 00:00:00 UTC in milliseconds
	ConcordEpoch int64 = 1762041600000

	WorkerIDBits  = 5
	ProcessIDBits = 5
	SequenceBits  = 12

	MaxWorkerID  = (1 << WorkerIDBits) - 1  // 31
	MaxProcessID = (1 << ProcessIDBits) - 1 // 31
	MaxSequence  = (1 << SequenceBits) - 1  // 4095

	WorkerIDShift  = SequenceBits + ProcessIDBits                // 17
	ProcessIDShift = SequenceBits                               // 12
	TimestampShift = SequenceBits + ProcessIDBits + WorkerIDBits // 22

	SequenceMask  = MaxSequence  // 0x0FFF
	WorkerIDMask  = MaxWorkerID  // 0x1F
	ProcessIDMask = MaxProcessID // 0x1F
)

var (
	ErrClockDrift       = errors.New("snowflake: clock drift detected beyond tolerable threshold")
	ErrPreEpoch         = errors.New("snowflake: system time is before Concord epoch")
	ErrInvalidWorkerID  = errors.New("snowflake: worker ID out of range [0, 31]")
	ErrInvalidProcessID = errors.New("snowflake: process ID out of range [0, 31]")
	ErrInvalidID        = errors.New("snowflake: invalid ID string representation")
)

// ID represents a 64-bit Concord Snowflake identifier.
type ID int64

// Int64 returns the raw int64 representation.
func (id ID) Int64() int64 {
	return int64(id)
}

// String returns the decimal string representation.
func (id ID) String() string {
	return strconv.FormatInt(int64(id), 10)
}

// Time extracts the UTC creation time of the ID.
func (id ID) Time() time.Time {
	ms := (int64(id) >> TimestampShift) + ConcordEpoch
	return time.UnixMilli(ms).UTC()
}

// Timestamp returns the Unix timestamp in milliseconds.
func (id ID) Timestamp() int64 {
	return (int64(id) >> TimestampShift) + ConcordEpoch
}

// WorkerID extracts the worker ID.
func (id ID) WorkerID() int64 {
	return (int64(id) >> WorkerIDShift) & WorkerIDMask
}

// ProcessID extracts the process ID.
func (id ID) ProcessID() int64 {
	return (int64(id) >> ProcessIDShift) & ProcessIDMask
}

// Sequence extracts the sequence number.
func (id ID) Sequence() int64 {
	return int64(id) & SequenceMask
}

// Parse parses a decimal string into a snowflake.ID.
func Parse(s string) (ID, error) {
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: %s", ErrInvalidID, s)
	}
	return ID(v), nil
}

// MarshalJSON encodes the Snowflake ID as a JSON decimal string.
// This prevents JavaScript IEEE 754 53-bit truncation.
func (id ID) MarshalJSON() ([]byte, error) {
	return []byte(strconv.Quote(id.String())), nil
}

// UnmarshalJSON decodes a Snowflake ID from a JSON string or numeric literal.
func (id *ID) UnmarshalJSON(b []byte) error {
	s := string(b)
	if s == "null" || s == `""` {
		*id = 0
		return nil
	}

	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		s = s[1 : len(s)-1]
	}

	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrInvalidID, s)
	}
	*id = ID(v)
	return nil
}

// Value implements driver.Valuer for PostgreSQL BIGINT persistence.
func (id ID) Value() (driver.Value, error) {
	return int64(id), nil
}

// Scan implements sql.Scanner for PostgreSQL BIGINT retrieval.
func (id *ID) Scan(src interface{}) error {
	if src == nil {
		*id = 0
		return nil
	}

	switch v := src.(type) {
	case int64:
		*id = ID(v)
		return nil
	case int:
		*id = ID(int64(v))
		return nil
	case []byte:
		parsed, err := strconv.ParseInt(string(v), 10, 64)
		if err != nil {
			return err
		}
		*id = ID(parsed)
		return nil
	case string:
		parsed, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return err
		}
		*id = ID(parsed)
		return nil
	default:
		return fmt.Errorf("snowflake: cannot scan %T into snowflake.ID", src)
	}
}

// Generator generates 64-bit Snowflake IDs with thread-safe synchronization.
type Generator struct {
	mu        sync.Mutex
	workerID  int64
	processID int64
	sequence  int64
	lastMs    int64
}

// New creates a new Snowflake generator instance.
func New(workerID, processID int64) (*Generator, error) {
	if workerID < 0 || workerID > MaxWorkerID {
		return nil, fmt.Errorf("%w: got %d", ErrInvalidWorkerID, workerID)
	}
	if processID < 0 || processID > MaxProcessID {
		return nil, fmt.Errorf("%w: got %d", ErrInvalidProcessID, processID)
	}

	return &Generator{
		workerID:  workerID,
		processID: processID,
		sequence:  0,
		lastMs:    -1,
	}, nil
}

// NextID generates the next unique 64-bit Snowflake ID.
func (g *Generator) NextID() (ID, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	now := time.Now().UnixMilli() - ConcordEpoch
	if now < 0 {
		return 0, ErrPreEpoch
	}

	// Handle clock drift backward
	for now < g.lastMs {
		diff := g.lastMs - now
		if diff > 5000 {
			return 0, fmt.Errorf("%w: clock moved backwards by %d ms", ErrClockDrift, diff)
		}
		time.Sleep(time.Duration(diff) * time.Millisecond)
		now = time.Now().UnixMilli() - ConcordEpoch
		if now < 0 {
			return 0, ErrPreEpoch
		}
	}

	if now == g.lastMs {
		g.sequence = (g.sequence + 1) & SequenceMask
		if g.sequence == 0 {
			for now <= g.lastMs {
				time.Sleep(50 * time.Microsecond)
				now = time.Now().UnixMilli() - ConcordEpoch
			}
		}
	} else {
		g.sequence = 0
	}

	g.lastMs = now
	val := (now << TimestampShift) |
		(g.workerID << WorkerIDShift) |
		(g.processID << ProcessIDShift) |
		g.sequence

	return ID(val), nil
}

var (
	defaultGen  *Generator
	defaultOnce sync.Once
)

// InitDefault initializes the package-level default generator.
func InitDefault(workerID, processID int64) error {
	var err error
	defaultOnce.Do(func() {
		defaultGen, err = New(workerID, processID)
	})
	return err
}

// Generate generates an ID using the default generator.
func Generate() (ID, error) {
	if defaultGen == nil {
		return 0, errors.New("snowflake: default generator not initialized")
	}
	return defaultGen.NextID()
}
