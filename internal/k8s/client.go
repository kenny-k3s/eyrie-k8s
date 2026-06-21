package k8s

import (
	"os"
	"path/filepath"

	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Client holds the Kubernetes client set and dynamic client
type Client struct {
	Clientset kubernetes.Interface
	Dynamic   dynamic.Interface
	Namespace string
}

// NewClient initializes a new Kubernetes client. It first tries in-cluster config,
// then falls back to local kubeconfig.
func NewClient() (*Client, error) {
	var config *rest.Config
	var err error

	// Try in-cluster first
	config, err = rest.InClusterConfig()
	if err != nil {
		// Fall back to kubeconfig
		kubeconfig := os.Getenv("KUBECONFIG")
		if kubeconfig == "" {
			home, _ := os.UserHomeDir()
			kubeconfig = filepath.Join(home, ".kube", "config")
		}
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, err
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	dynClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	// Determine namespace (downward API or default)
	ns := os.Getenv("POD_NAMESPACE")
	if ns == "" {
		ns = "ai-agents"
	}

	return &Client{
		Clientset: clientset,
		Dynamic:   dynClient,
		Namespace: ns,
	}, nil
}
