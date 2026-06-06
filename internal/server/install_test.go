package server

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Audacity88/eyrie/internal/registry"
)

func TestSetupAdapterSupportsCodexAppServer(t *testing.T) {
	progress := &installProgress{}
	err := setupAdapter(&registry.Framework{AdapterType: "app-server"}, progress)
	if err != nil {
		t.Fatalf("setupAdapter app-server error = %v", err)
	}
}

func TestScaffoldConfigCreatesSchemaDefaultConfig(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.json")
	fw := &registry.Framework{
		ConfigFormat: "json",
		ConfigPath:   configPath,
		ConfigSchema: &registry.ConfigSchema{CommonFields: []registry.ConfigField{
			{Key: "binary_path", Default: "codex"},
			{Key: "model", Default: "gpt-5.4"},
		}},
	}

	progress := &installProgress{}
	if err := scaffoldConfig(context.Background(), fw, "", progress); err != nil {
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

func TestFrameworkVersionCachesBinaryProbe(t *testing.T) {
	resetFrameworkVersionCacheForTest()
	t.Cleanup(resetFrameworkVersionCacheForTest)

	dir := t.TempDir()
	counterPath := filepath.Join(dir, "counter")
	binaryPath := filepath.Join(dir, "fake-framework")
	script := fmt.Sprintf(`#!/bin/sh
count=0
if [ -f %[1]q ]; then
  count=$(cat %[1]q)
fi
count=$((count + 1))
printf '%%s\n' "$count" > %[1]q
printf 'fake-framework 1.2.3\n'
`, counterPath)
	if err := os.WriteFile(binaryPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	fw := registry.Framework{ID: "fake-framework", BinaryPath: binaryPath}
	if got := frameworkVersion(fw); got != "fake-framework 1.2.3" {
		t.Fatalf("first frameworkVersion = %q", got)
	}
	if got := frameworkVersion(fw); got != "fake-framework 1.2.3" {
		t.Fatalf("second frameworkVersion = %q", got)
	}
	data, err := os.ReadFile(counterPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(data)); got != "1" {
		t.Fatalf("binary probe count = %s, want 1", got)
	}
}
