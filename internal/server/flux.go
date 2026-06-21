package server

import (
	"context"
	"net/http"
	"time"

	"github.com/Audacity88/eyrie/internal/k8s"
)

func (s *Server) handleFluxStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	k8sClient, err := k8s.NewClient()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{
			"sync_status": "Disabled",
			"message":     "Kubernetes client unavailable: " + err.Error(),
		})
		return
	}

	mgr := k8s.NewManager(k8sClient)
	status, err := mgr.FluxStatus(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, status)
}
