package k8s

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	fakeclientset "k8s.io/client-go/kubernetes/fake"
)

func TestDiscover(t *testing.T) {
	clientset := fakeclientset.NewSimpleClientset()
	client := &Client{
		Clientset: clientset,
		Namespace: "ai-agents",
	}
	mgr := NewManager(client)

	// Create a dummy deployment with eyrie.io/managed=true
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-agent",
			Namespace: "ai-agents",
			Labels: map[string]string{
				LabelManaged:   "true",
				LabelFramework: "zeroclaw",
			},
			Annotations: map[string]string{
				AnnotConfigPath: "/some/path/config.toml",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: int32Ptr(1),
		},
		Status: appsv1.DeploymentStatus{
			AvailableReplicas: 1,
		},
	}

	_, err := clientset.AppsV1().Deployments("ai-agents").Create(context.Background(), dep, metav1.CreateOptions{})
	if err != nil {
		t.Fatalf("failed to create deployment: %v", err)
	}

	workloads, err := mgr.Discover(context.Background())
	if err != nil {
		t.Fatalf("Discover failed: %v", err)
	}

	if len(workloads) != 1 {
		t.Errorf("expected 1 workload, got %d", len(workloads))
	}

	w := workloads[0]
	if w.Name != "test-agent" || w.Framework != "zeroclaw" || w.Status != "Running" {
		t.Errorf("unexpected workload values: %+v", w)
	}
}

func int32Ptr(i int32) *int32 {
	return &i
}
