package instance

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Audacity88/eyrie/internal/adapter"
)

func TestProvisionCodexCreatesManagedHomeAndInstructions(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	parentCodexHome := filepath.Join(home, ".codex")
	if err := os.MkdirAll(parentCodexHome, 0o700); err != nil {
		t.Fatalf("mkdir parent codex home: %v", err)
	}
	parentAuth := []byte(`{"mode":"test"}`)
	if err := os.WriteFile(filepath.Join(parentCodexHome, "auth.json"), parentAuth, 0o600); err != nil {
		t.Fatalf("write parent auth: %v", err)
	}

	store, err := NewStore()
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	provisioner := NewProvisioner(store)

	inst, err := provisioner.Provision(CreateRequest{
		Name:               "codex-captain",
		Framework:          adapter.FrameworkCodex,
		HierarchyRole:      RoleCaptain,
		ProjectName:        "Eyrie",
		ProjectGoal:        "Coordinate long-lived agents",
		ProjectDescription: "Runtime comparison work",
	}, nil)
	if err != nil {
		t.Fatalf("provision codex: %v", err)
	}

	var cfg map[string]any
	data, err := os.ReadFile(inst.ConfigPath)
	if err != nil {
		t.Fatalf("read codex config: %v", err)
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse codex config: %v", err)
	}

	wantHome := filepath.Join(filepath.Dir(inst.ConfigPath), "codex-home")
	if cfg["codex_home"] != wantHome {
		t.Fatalf("codex_home = %#v, want %q", cfg["codex_home"], wantHome)
	}
	if cfg["instructions_path"] != filepath.Join(inst.WorkspacePath, "AGENTS.md") {
		t.Fatalf("instructions_path = %#v", cfg["instructions_path"])
	}

	authCopy, err := os.ReadFile(filepath.Join(wantHome, "auth.json"))
	if err != nil {
		t.Fatalf("read managed auth copy: %v", err)
	}
	if string(authCopy) != string(parentAuth) {
		t.Fatalf("auth copy = %q, want %q", string(authCopy), string(parentAuth))
	}

	agentsMD, err := os.ReadFile(filepath.Join(inst.WorkspacePath, "AGENTS.md"))
	if err != nil {
		t.Fatalf("read codex instructions: %v", err)
	}
	for _, want := range []string{
		"long-lived Eyrie agent",
		"Codex App Server",
		"Project: Eyrie",
		"Goal: Coordinate long-lived agents",
		"SOUL.md",
		"IDENTITY.md",
		"TOOLS.md",
		"MEMORY.md",
	} {
		if !strings.Contains(string(agentsMD), want) {
			t.Fatalf("AGENTS.md missing %q:\n%s", want, string(agentsMD))
		}
	}
}
