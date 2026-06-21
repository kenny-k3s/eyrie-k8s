package k8s

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Status aggregates pod phase, container ready, restarts, and optional resource usage
func (m *k8sManager) Status(ctx context.Context, name string) (*WorkloadStatus, error) {
	podName, containerName, err := m.findActivePodAndContainer(ctx, name)
	if err != nil {
		return &WorkloadStatus{
			Name:      name,
			Namespace: m.client.Namespace,
			PodPhase:  "Stopped",
		}, nil
	}

	pod, err := m.client.Clientset.CoreV1().Pods(m.client.Namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	status := &WorkloadStatus{
		Name:      name,
		Namespace: m.client.Namespace,
		PodPhase:  string(pod.Status.Phase),
	}

	// Calculate uptime
	if pod.Status.StartTime != nil {
		status.Uptime = time.Since(pod.Status.StartTime.Time)
	}

	// Find the target container status
	var targetCont corev1.ContainerStatus
	found := false
	for _, c := range pod.Status.ContainerStatuses {
		if c.Name == containerName {
			targetCont = c
			found = true
			break
		}
	}

	if found {
		status.ContainerReady = targetCont.Ready
		status.RestartCount = int(targetCont.RestartCount)
		if targetCont.State.Waiting != nil {
			status.Message = targetCont.State.Waiting.Reason + ": " + targetCont.State.Waiting.Message
		} else if targetCont.State.Terminated != nil {
			status.Message = targetCont.State.Terminated.Reason + ": " + targetCont.State.Terminated.Message
		}
	} else if len(pod.Status.ContainerStatuses) > 0 {
		// Fallback to first container status
		status.ContainerReady = pod.Status.ContainerStatuses[0].Ready
		status.RestartCount = int(pod.Status.ContainerStatuses[0].RestartCount)
	}

	// Retrieve CPU and Memory usage from metrics-server
	m.fillPodMetrics(ctx, podName, containerName, status)

	return status, nil
}

func (m *k8sManager) fillPodMetrics(ctx context.Context, podName, containerName string, status *WorkloadStatus) {
	gvr := schema.GroupVersionResource{
		Group:    "metrics.k8s.io",
		Version:  "v1beta1",
		Resource: "pods",
	}

	res, err := m.client.Dynamic.Resource(gvr).Namespace(m.client.Namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		slog.Debug("metrics-server pod metrics lookup failed (ignoring)", "pod", podName, "err", err)
		return
	}

	containers, found, err := unstructured.NestedSlice(res.Object, "containers")
	if err != nil || !found {
		return
	}

	for _, cObj := range containers {
		c, ok := cObj.(map[string]interface{})
		if !ok {
			continue
		}
		cName, _, _ := unstructured.NestedString(c, "name")
		if cName != containerName {
			continue
		}

		cpuStr, _, _ := unstructured.NestedString(c, "usage", "cpu")
		memStr, _, _ := unstructured.NestedString(c, "usage", "memory")

		status.CPUUsageCores = parseCPU(cpuStr)
		status.MemoryUsageBytes = parseMemory(memStr)
		break
	}
}

// parseCPU converts K8s CPU quantity (e.g. "100m", "1500000n") to fractional cores
func parseCPU(s string) float64 {
	if s == "" {
		return 0
	}
	if strings.HasSuffix(s, "n") {
		v, _ := strconv.ParseFloat(strings.TrimSuffix(s, "n"), 64)
		return v / 1e9
	}
	if strings.HasSuffix(s, "u") {
		v, _ := strconv.ParseFloat(strings.TrimSuffix(s, "u"), 64)
		return v / 1e6
	}
	if strings.HasSuffix(s, "m") {
		v, _ := strconv.ParseFloat(strings.TrimSuffix(s, "m"), 64)
		return v / 1e3
	}
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

// parseMemory converts K8s memory quantity (e.g. "256Mi", "1Gi", "1024Ki") to bytes
func parseMemory(s string) int64 {
	if s == "" {
		return 0
	}
	var multiplier int64 = 1
	suffix := ""
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] >= '0' && s[i] <= '9' {
			suffix = s[i+1:]
			s = s[:i+1]
			break
		}
	}
	switch strings.ToLower(suffix) {
	case "ki":
		multiplier = 1024
	case "mi":
		multiplier = 1024 * 1024
	case "gi":
		multiplier = 1024 * 1024 * 1024
	case "ti":
		multiplier = 1024 * 1024 * 1024 * 1024
	case "k":
		multiplier = 1000
	case "m":
		multiplier = 1000 * 1000
	case "g":
		multiplier = 1000 * 1000 * 1000
	}
	v, _ := strconv.ParseInt(s, 10, 64)
	return v * multiplier
}
