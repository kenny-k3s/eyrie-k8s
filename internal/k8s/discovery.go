package k8s

import (
	"context"
	"log/slog"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
)

const (
	LabelManaged    = "eyrie.io/managed"
	LabelFramework  = "eyrie.io/framework"
	LabelTier       = "eyrie.io/tier"
	AnnotConfigPath = "eyrie.io/config-path"
)

// Discover scans Kubernetes for Deployments and StatefulSets labeled for Eyrie management
func (m *k8sManager) Discover(ctx context.Context) ([]AgentWorkload, error) {
	var workloads []AgentWorkload

	// List Deployments
	deploys, err := m.client.Clientset.AppsV1().Deployments(m.client.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelManaged + "=true",
	})
	if err != nil {
		return nil, err
	}

	for _, d := range deploys.Items {
		workloads = append(workloads, AgentWorkload{
			Name:        d.Name,
			Framework:   getFramework(d.Labels, d.Name),
			Namespace:   d.Namespace,
			Replicas:    getReplicas(d.Spec.Replicas),
			Available:   d.Status.AvailableReplicas,
			Status:      deriveStatus(getReplicas(d.Spec.Replicas), d.Status.AvailableReplicas),
			ConfigPath:  d.Annotations[AnnotConfigPath],
		})
	}

	// List StatefulSets
	ssets, err := m.client.Clientset.AppsV1().StatefulSets(m.client.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: LabelManaged + "=true",
	})
	if err != nil {
		return nil, err
	}

	for _, s := range ssets.Items {
		workloads = append(workloads, AgentWorkload{
			Name:        s.Name,
			Framework:   getFramework(s.Labels, s.Name),
			Namespace:   s.Namespace,
			Replicas:    getReplicas(s.Spec.Replicas),
			Available:   s.Status.ReadyReplicas,
			Status:      deriveStatus(getReplicas(s.Spec.Replicas), s.Status.ReadyReplicas),
			ConfigPath:  s.Annotations[AnnotConfigPath],
		})
	}

	return workloads, nil
}

// Watch watches for changes in Deployments and StatefulSets and streams events
func (m *k8sManager) Watch(ctx context.Context) (<-chan WorkloadEvent, error) {
	out := make(chan WorkloadEvent, 100)

	// Watch Deployments
	dWatch, err := m.client.Clientset.AppsV1().Deployments(m.client.Namespace).Watch(ctx, metav1.ListOptions{
		LabelSelector: LabelManaged + "=true",
	})
	if err != nil {
		return nil, err
	}

	// Watch StatefulSets
	sWatch, err := m.client.Clientset.AppsV1().StatefulSets(m.client.Namespace).Watch(ctx, metav1.ListOptions{
		LabelSelector: LabelManaged + "=true",
	})
	if err != nil {
		dWatch.Stop()
		return nil, err
	}

	go func() {
		defer close(out)
		defer dWatch.Stop()
		defer sWatch.Stop()

		dChan := dWatch.ResultChan()
		sChan := sWatch.ResultChan()

		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-dChan:
				if !ok {
					slog.Warn("Deployment watch channel closed")
					return
				}
				if event.Type == watch.Error {
					slog.Error("Deployment watch encountered error", "err", event.Object)
					continue
				}
				if ev, ok := m.convertDeployEvent(event); ok {
					out <- ev
				}
			case event, ok := <-sChan:
				if !ok {
					slog.Warn("StatefulSet watch channel closed")
					return
				}
				if event.Type == watch.Error {
					slog.Error("StatefulSet watch encountered error", "err", event.Object)
					continue
				}
				if ev, ok := m.convertStatefulEvent(event); ok {
					out <- ev
				}
			}
		}
	}()

	return out, nil
}

func getFramework(labels map[string]string, name string) string {
	if fw, ok := labels[LabelFramework]; ok {
		return fw
	}
	// Fallbacks based on name
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "zeroclaw"):
		return "zeroclaw"
	case strings.Contains(n, "openclaw"):
		return "openclaw"
	case strings.Contains(n, "hermes"):
		return "hermes"
	}
	return "zeroclaw" // default
}

func getReplicas(r *int32) int32 {
	if r == nil {
		return 0
	}
	return *r
}

func deriveStatus(desired, available int32) string {
	if desired == 0 {
		return "Stopped"
	}
	if available == desired {
		return "Running"
	}
	return "Starting"
}

func (m *k8sManager) convertDeployEvent(e watch.Event) (WorkloadEvent, bool) {
	d, ok := e.Object.(*appsv1.Deployment)
	if !ok {
		return WorkloadEvent{}, false
	}
	return WorkloadEvent{
		Type: string(e.Type),
		Object: AgentWorkload{
			Name:        d.Name,
			Framework:   getFramework(d.Labels, d.Name),
			Namespace:   d.Namespace,
			Replicas:    getReplicas(d.Spec.Replicas),
			Available:   d.Status.AvailableReplicas,
			Status:      deriveStatus(getReplicas(d.Spec.Replicas), d.Status.AvailableReplicas),
			ConfigPath:  d.Annotations[AnnotConfigPath],
		},
	}, true
}

func (m *k8sManager) convertStatefulEvent(e watch.Event) (WorkloadEvent, bool) {
	s, ok := e.Object.(*appsv1.StatefulSet)
	if !ok {
		return WorkloadEvent{}, false
	}
	return WorkloadEvent{
		Type: string(e.Type),
		Object: AgentWorkload{
			Name:        s.Name,
			Framework:   getFramework(s.Labels, s.Name),
			Namespace:   s.Namespace,
			Replicas:    getReplicas(s.Spec.Replicas),
			Available:   s.Status.ReadyReplicas,
			Status:      deriveStatus(getReplicas(s.Spec.Replicas), s.Status.ReadyReplicas),
			ConfigPath:  s.Annotations[AnnotConfigPath],
		},
	}, true
}
