package k8s

import (
	"context"
	"fmt"
	"io"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// Logs streams logs for the given agent workload
func (m *k8sManager) Logs(ctx context.Context, name string, follow bool) (io.ReadCloser, error) {
	podName, containerName, err := m.findActivePodAndContainer(ctx, name)
	if err != nil {
		return nil, err
	}

	tailLines := int64(200)
	podLogOptions := &corev1.PodLogOptions{
		Follow:     follow,
		Container:  containerName,
		TailLines:  &tailLines,
		Timestamps: false,
	}

	req := m.client.Clientset.CoreV1().Pods(m.client.Namespace).GetLogs(podName, podLogOptions)
	return req.Stream(ctx)
}

func (m *k8sManager) findActivePodAndContainer(ctx context.Context, name string) (string, string, error) {
	wType, err := m.resolveWorkloadType(ctx, name)
	if err != nil {
		return "", "", err
	}

	var selector map[string]string
	var containerName string

	if wType == "Deployment" {
		d, err := m.client.Clientset.AppsV1().Deployments(m.client.Namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", "", err
		}
		selector = d.Spec.Selector.MatchLabels
		if len(d.Spec.Template.Spec.Containers) > 0 {
			containerName = d.Spec.Template.Spec.Containers[0].Name
		}
	} else {
		s, err := m.client.Clientset.AppsV1().StatefulSets(m.client.Namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return "", "", err
		}
		selector = s.Spec.Selector.MatchLabels
		if len(s.Spec.Template.Spec.Containers) > 0 {
			containerName = s.Spec.Template.Spec.Containers[0].Name
		}
	}

	if len(selector) == 0 {
		return "", "", fmt.Errorf("no selector defined for workload %s", name)
	}

	// List pods matching selector
	listOpt := metav1.ListOptions{
		LabelSelector: labels.Set(selector).String(),
	}
	pods, err := m.client.Clientset.CoreV1().Pods(m.client.Namespace).List(ctx, listOpt)
	if err != nil {
		return "", "", err
	}

	if len(pods.Items) == 0 {
		return "", "", fmt.Errorf("no running pods found for agent %s", name)
	}

	// Find the most recent active/running pod
	var bestPod *corev1.Pod
	for _, p := range pods.Items {
		if p.Status.Phase == corev1.PodRunning {
			bestPod = &p
			break
		}
	}

	if bestPod == nil {
		// Fallback to the first pod in list
		bestPod = &pods.Items[0]
	}

	// Override containerName if the pod has multiple containers and one is exactly the workload name
	if len(bestPod.Spec.Containers) > 1 {
		for _, c := range bestPod.Spec.Containers {
			if c.Name == name {
				containerName = c.Name
				break
			}
		}
	}

	return bestPod.Name, containerName, nil
}
