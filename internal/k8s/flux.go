package k8s

import (
	"context"
	"log/slog"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// FluxStatus retrieves the sync status of the "ai-agents" Kustomization in the "flux-system" namespace
func (m *k8sManager) FluxStatus(ctx context.Context) (*FluxSyncStatus, error) {
	// Try v1 first, then fall back to v1beta2
	versions := []string{"v1", "v1beta2"}
	var res *unstructured.Unstructured
	var err error

	for _, v := range versions {
		gvr := schema.GroupVersionResource{
			Group:    "kustomize.toolkit.fluxcd.io",
			Version:  v,
			Resource: "kustomizations",
		}
		res, err = m.client.Dynamic.Resource(gvr).Namespace("flux-system").Get(ctx, "ai-agents", metav1.GetOptions{})
		if err == nil {
			break
		}
		if !apierrors.IsNotFound(err) {
			slog.Debug("Flux Kustomization lookup returned error", "version", v, "err", err)
		}
	}

	if err != nil {
		return &FluxSyncStatus{
			Name:       "ai-agents",
			SyncStatus: "Unknown",
			Message:    err.Error(),
		}, nil
	}

	status := &FluxSyncStatus{
		Name: "ai-agents",
	}

	// Extract lastAppliedRevision
	if rev, found, err := unstructured.NestedString(res.Object, "status", "lastAppliedRevision"); err == nil && found {
		status.LastApplied = rev
	}

	// Extract lastHandledReconcileAt or status transition time
	if lastSync, found, err := unstructured.NestedString(res.Object, "status", "lastHandledReconcileAt"); err == nil && found {
		if parsed, parseErr := time.Parse(time.RFC3339, lastSync); parseErr == nil {
			status.LastSyncTime = parsed
		}
	}

	// Extract conditions
	conditions, found, err := unstructured.NestedSlice(res.Object, "status", "conditions")
	if err == nil && found {
		for _, condObj := range conditions {
			cond, ok := condObj.(map[string]interface{})
			if !ok {
				continue
			}
			cType, _, _ := unstructured.NestedString(cond, "type")
			if cType == "Ready" {
				cStatus, _, _ := unstructured.NestedString(cond, "status")
				cReason, _, _ := unstructured.NestedString(cond, "reason")
				cMsg, _, _ := unstructured.NestedString(cond, "message")

				status.Message = cMsg
				if status.LastSyncTime.IsZero() {
					// Fallback to condition transition time if lastHandledReconcileAt not available
					if transTime, _, _ := unstructured.NestedString(cond, "lastTransitionTime"); transTime != "" {
						if parsed, parseErr := time.Parse(time.RFC3339, transTime); parseErr == nil {
							status.LastSyncTime = parsed
						}
					}
				}

				switch cStatus {
				case "True":
					status.SyncStatus = "Ready"
				case "False":
					if cReason == "Reconciling" {
						status.SyncStatus = "Reconciling"
					} else {
						status.SyncStatus = "Failed"
					}
				default:
					status.SyncStatus = "Reconciling"
				}
				break
			}
		}
	}

	if status.SyncStatus == "" {
		status.SyncStatus = "Reconciling"
	}

	return status, nil
}
