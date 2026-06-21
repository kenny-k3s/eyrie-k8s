package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// Start scales the workload to 1 replica
func (m *k8sManager) Start(ctx context.Context, name string) error {
	return m.Scale(ctx, name, 1)
}

// Stop scales the workload to 0 replicas
func (m *k8sManager) Stop(ctx context.Context, name string) error {
	return m.Scale(ctx, name, 0)
}

// Scale sets the replicas of a Deployment or StatefulSet
func (m *k8sManager) Scale(ctx context.Context, name string, replicas int32) error {
	wType, err := m.resolveWorkloadType(ctx, name)
	if err != nil {
		return err
	}

	patchData := map[string]interface{}{
		"spec": map[string]interface{}{
			"replicas": replicas,
		},
	}
	playLoadBytes, err := json.Marshal(patchData)
	if err != nil {
		return err
	}

	if wType == "Deployment" {
		_, err = m.client.Clientset.AppsV1().Deployments(m.client.Namespace).Patch(
			ctx, name, types.MergePatchType, playLoadBytes, metav1.PatchOptions{},
		)
	} else {
		_, err = m.client.Clientset.AppsV1().StatefulSets(m.client.Namespace).Patch(
			ctx, name, types.MergePatchType, playLoadBytes, metav1.PatchOptions{},
		)
	}

	return err
}

// Restart triggers a rollout restart by updating the restartedAt annotation on the pod template
func (m *k8sManager) Restart(ctx context.Context, name string) error {
	wType, err := m.resolveWorkloadType(ctx, name)
	if err != nil {
		return err
	}

	patchData := map[string]interface{}{
		"spec": map[string]interface{}{
			"template": map[string]interface{}{
				"metadata": map[string]interface{}{
					"annotations": map[string]interface{}{
						"kubectl.kubernetes.io/restartedAt": time.Now().Format(time.RFC3339),
					},
				},
			},
		},
	}
	playLoadBytes, err := json.Marshal(patchData)
	if err != nil {
		return err
	}

	if wType == "Deployment" {
		_, err = m.client.Clientset.AppsV1().Deployments(m.client.Namespace).Patch(
			ctx, name, types.StrategicMergePatchType, playLoadBytes, metav1.PatchOptions{},
		)
	} else {
		_, err = m.client.Clientset.AppsV1().StatefulSets(m.client.Namespace).Patch(
			ctx, name, types.StrategicMergePatchType, playLoadBytes, metav1.PatchOptions{},
		)
	}

	return err
}

func (m *k8sManager) resolveWorkloadType(ctx context.Context, name string) (string, error) {
	_, err := m.client.Clientset.AppsV1().Deployments(m.client.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		return "Deployment", nil
	}
	if !apierrors.IsNotFound(err) {
		return "", err
	}

	_, err = m.client.Clientset.AppsV1().StatefulSets(m.client.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err == nil {
		return "StatefulSet", nil
	}
	if apierrors.IsNotFound(err) {
		return "", fmt.Errorf("workload %q not found as Deployment or StatefulSet in namespace %q", name, m.client.Namespace)
	}
	return "", err
}
