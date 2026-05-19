package cli

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Audacity88/eyrie/internal/registry"
)

func TestSetupAdapterSupportsCodexAppServer(t *testing.T) {
	err := setupAdapter(&registry.Framework{AdapterType: "app-server"})
	if err != nil {
		t.Fatalf("setupAdapter app-server error = %v", err)
	}
}

func TestScaffoldConfigCreatesSchemaDefaultConfig(t *testing.T) {
	oldFlags := installFlags
	installFlags.copyFrom = ""
	installFlags.yes = true
	t.Cleanup(func() { installFlags = oldFlags })

	configPath := filepath.Join(t.TempDir(), "config.json")
	fw := &registry.Framework{
		ConfigFormat: "json",
		ConfigPath:   configPath,
		ConfigSchema: &registry.ConfigSchema{CommonFields: []registry.ConfigField{
			{Key: "binary_path", Default: "codex"},
			{Key: "model", Default: "gpt-5.4"},
		}},
	}

	if err := scaffoldConfig(context.Background(), fw); err != nil {
		t.Fatalf("scaffoldConfig error = %v", err)
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got["binary_path"] != "codex" || got["model"] != "gpt-5.4" {
		t.Fatalf("unexpected config defaults: %#v", got)
	}
}
