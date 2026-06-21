package k8s

import (
	"context"
	"io"
	"time"
)

// AgentWorkload represents an agent workload discovered in K8s
type AgentWorkload struct {
	Name        string `json:"name"`
	Framework   string `json:"framework"` // "zeroclaw", "openclaw", "hermes"
	Namespace   string `json:"namespace"`
	Replicas    int32  `json:"replicas"`
	Available   int32  `json:"available_replicas"`
	Status      string `json:"status"` // "Running", "Stopped", "Starting", "CrashLoopBackOff", etc.
	ConfigPath  string `json:"config_path"`
}

// WorkloadEvent is fired when agent workloads are added/modified/deleted
type WorkloadEvent struct {
	Type   string        `json:"type"` // "ADDED", "MODIFIED", "DELETED"
	Object AgentWorkload `json:"object"`
}

// WorkloadStatus represents the runtime status of an agent pod
type WorkloadStatus struct {
	Name             string    `json:"name"`
	Namespace        string    `json:"namespace"`
	PodPhase         string    `json:"pod_phase"` // e.g. "Running", "Pending", "Failed"
	ContainerReady   bool      `json:"container_ready"`
	RestartCount     int       `json:"restart_count"`
	Message          string    `json:"message,omitempty"`
	CPUUsageCores    float64   `json:"cpu_usage_cores,omitempty"`
	MemoryUsageBytes int64     `json:"memory_usage_bytes,omitempty"`
	Uptime           time.Duration `json:"uptime"`
}

// FluxSyncStatus represents the GitOps reconciliation status for the agent fleet
type FluxSyncStatus struct {
	Name          string    `json:"name"`
	SyncStatus    string    `json:"sync_status"` // "Ready", "Reconciling", "Failed"
	LastApplied   string    `json:"last_applied_revision"`
	LastSyncTime  time.Time `json:"last_sync_time"`
	Message       string    `json:"message,omitempty"`
}

// Manager defines the interface for interacting with the agent fleet in Kubernetes
type Manager interface {
	// Discovery
	Discover(ctx context.Context) ([]AgentWorkload, error)
	Watch(ctx context.Context) (<-chan WorkloadEvent, error)

	// Lifecycle
	Start(ctx context.Context, name string) error
	Stop(ctx context.Context, name string) error
	Restart(ctx context.Context, name string) error
	Scale(ctx context.Context, name string, replicas int32) error

	// Observability
	Status(ctx context.Context, name string) (*WorkloadStatus, error)
	Logs(ctx context.Context, name string, follow bool) (io.ReadCloser, error)
	FluxStatus(ctx context.Context) (*FluxSyncStatus, error)
}

// k8sManager implements the Manager interface using client-go
type k8sManager struct {
	client *Client
}

// NewManager creates a new K8s-native manager
func NewManager(client *Client) Manager {
	return &k8sManager{
		client: client,
	}
}
