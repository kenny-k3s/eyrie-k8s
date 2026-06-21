package manager

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Audacity88/eyrie/internal/config"
	"github.com/Audacity88/eyrie/internal/k8s"
)

type LifecycleAction string

const (
	ActionStart   LifecycleAction = "start"
	ActionStop    LifecycleAction = "stop"
	ActionRestart LifecycleAction = "restart"
)

// Execute runs a lifecycle action for the given framework.
func Execute(ctx context.Context, framework string, action LifecycleAction) error {
	k8sClient, err := k8s.NewClient()
	if err == nil {
		mgr := k8s.NewManager(k8sClient)
		workloads, err := mgr.Discover(ctx)
		if err == nil && len(workloads) > 0 {
			// Find workload by framework
			var target string
			for _, w := range workloads {
				if w.Framework == framework {
					target = w.Name
					break
				}
			}
			if target != "" {
				return runK8sAction(ctx, mgr, target, action)
			}
		}
	}

	// Fallback to legacy local execution
	return executeLegacy(ctx, framework, action)
}

// ExecuteWithConfig runs a lifecycle action for a framework using a specific config path.
func ExecuteWithConfig(ctx context.Context, framework, configPath string, action LifecycleAction) error {
	return ExecuteWithConfigEnv(ctx, framework, configPath, action, nil)
}

// ExecuteWithConfigEnv runs a lifecycle action for a framework using a specific config path and environment.
func ExecuteWithConfigEnv(ctx context.Context, framework, configPath string, action LifecycleAction, extraEnv []string) error {
	k8sClient, err := k8s.NewClient()
	if err == nil {
		mgr := k8s.NewManager(k8sClient)
		workloads, err := mgr.Discover(ctx)
		if err == nil && len(workloads) > 0 {
			var target string
			// 1. Try exact config path match
			for _, w := range workloads {
				if w.ConfigPath == configPath {
					target = w.Name
					break
				}
			}
			// 2. Try matching workload name in config path
			if target == "" {
				for _, w := range workloads {
					if strings.Contains(configPath, w.Name) {
						target = w.Name
						break
					}
				}
			}
			// 3. Fallback to first workload of this framework
			if target == "" {
				for _, w := range workloads {
					if w.Framework == framework {
						target = w.Name
						break
					}
				}
			}
			if target != "" {
				return runK8sAction(ctx, mgr, target, action)
			}
		}
	}

	// Fallback to legacy local execution
	return executeLegacyWithConfigEnv(ctx, framework, configPath, action, extraEnv)
}

func runK8sAction(ctx context.Context, mgr k8s.Manager, target string, action LifecycleAction) error {
	switch action {
	case ActionStart:
		return mgr.Start(ctx, target)
	case ActionStop:
		return mgr.Stop(ctx, target)
	case ActionRestart:
		return mgr.Restart(ctx, target)
	default:
		return fmt.Errorf("unknown action %q for Kubernetes workload %q", action, target)
	}
}

// Legacy Local Execution Logic Below

func executeLegacy(ctx context.Context, framework string, action LifecycleAction) error {
	switch framework {
	case "zeroclaw":
		return executeZeroClaw(ctx, action)
	case "openclaw":
		return executeOpenClaw(ctx, action)
	case "hermes":
		return executeHermes(ctx, action)
	case "picoclaw":
		return executePicoClaw(ctx, action)
	case "embedded":
		return nil
	case "codex":
		return nil
	default:
		return fmt.Errorf("unknown framework %q: cannot determine lifecycle command", framework)
	}
}

func executeZeroClaw(ctx context.Context, action LifecycleAction) error {
	if action == ActionStart || action == ActionRestart {
		if serviceInstalled(ctx, "zeroclaw") {
			return run(ctx, "zeroclaw", "service", string(action))
		}
		if err := run(ctx, "zeroclaw", "service", "install"); err != nil {
			return fmt.Errorf("service not installed and auto-install failed: %w\nYou can also start manually with: zeroclaw daemon", err)
		}
		return run(ctx, "zeroclaw", "service", string(action))
	}
	svcErr := run(ctx, "zeroclaw", "service", string(action))
	killCmd := exec.CommandContext(ctx, "pkill", "-f", "zeroclaw daemon")
	killErr := killCmd.Run()
	if svcErr != nil && killErr != nil {
		if exitErr, ok := killErr.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return svcErr
		}
		return fmt.Errorf("service stop: %v; pkill: %v", svcErr, killErr)
	}
	return nil
}

func executeOpenClaw(ctx context.Context, action LifecycleAction) error {
	logDir := config.ExpandHome("~/.openclaw/logs")
	switch action {
	case ActionStart:
		return runDetachedWithNode22(ctx, logDir, "openclaw", "gateway", "run")
	case ActionRestart:
		if err := stopOpenClawGateway(ctx); err != nil {
			fmt.Fprintf(os.Stderr, "eyrie: openclaw stop before restart: %v\n", err)
		}
		return runDetachedWithNode22(ctx, logDir, "openclaw", "gateway", "run")
	case ActionStop:
		return stopOpenClawGateway(ctx)
	default:
		return fmt.Errorf("unknown action %q for openclaw", action)
	}
}

func stopOpenClawGateway(ctx context.Context) error {
	svcErr := runWithNode22(ctx, "openclaw", "gateway", "stop")
	killCmd := exec.CommandContext(ctx, "pkill", "-f", `(openclaw.*gateway run|dist/index\.js gateway)`)
	killErr := killCmd.Run()
	if svcErr == nil || killErr == nil {
		return nil
	}
	if exitErr, ok := killErr.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
		return nil
	}
	return fmt.Errorf("service stop: %v; pkill: %v", svcErr, killErr)
}

func node22BinDir() string {
	home := os.Getenv("HOME")
	if home == "" {
		return ""
	}
	nvmDir := filepath.Join(home, ".nvm", "versions", "node")
	entries, err := os.ReadDir(nvmDir)
	if err != nil {
		return ""
	}
	var v22Dirs []string
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), "v22.") {
			v22Dirs = append(v22Dirs, e.Name())
		}
	}
	if len(v22Dirs) == 0 {
		return ""
	}
	sort.Slice(v22Dirs, func(i, j int) bool {
		return compareNodeVersions(v22Dirs[i], v22Dirs[j]) < 0
	})
	return filepath.Join(nvmDir, v22Dirs[len(v22Dirs)-1], "bin")
}

func compareNodeVersions(a, b string) int {
	partsA := strings.Split(strings.TrimPrefix(a, "v"), ".")
	partsB := strings.Split(strings.TrimPrefix(b, "v"), ".")
	maxLen := len(partsA)
	if len(partsB) > maxLen {
		maxLen = len(partsB)
	}
	for i := 0; i < maxLen; i++ {
		var na, nb int
		if i < len(partsA) {
			na, _ = strconv.Atoi(partsA[i])
		}
		if i < len(partsB) {
			nb, _ = strconv.Atoi(partsB[i])
		}
		if na != nb {
			return na - nb
		}
	}
	return 0
}

func node22Env() []string {
	binDir := node22BinDir()
	if binDir == "" {
		return nil
	}
	env := config.EnrichedEnv()
	for i, e := range env {
		if strings.HasPrefix(e, "PATH=") {
			env[i] = "PATH=" + binDir + string(os.PathListSeparator) + e[5:]
			break
		}
	}
	return env
}

func runWithNode22(ctx context.Context, command string, args ...string) error {
	cmd := exec.CommandContext(ctx, config.LookPathEnriched(command), args...)
	if env := node22Env(); env != nil {
		cmd.Env = env
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w\n%s", command, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func executeHermes(ctx context.Context, action LifecycleAction) error {
	switch action {
	case ActionStart:
		if !hermesServiceInstalled(ctx) {
			if err := run(ctx, "hermes", "gateway", "install"); err != nil {
				return fmt.Errorf("failed to install hermes service: %w", err)
			}
		}
		return run(ctx, "hermes", "gateway", "start")
	case ActionStop:
		return run(ctx, "hermes", "gateway", "stop")
	case ActionRestart:
		return run(ctx, "hermes", "gateway", "restart")
	default:
		return fmt.Errorf("unsupported action %q for Hermes", action)
	}
}

func executePicoClaw(ctx context.Context, action LifecycleAction) error {
	switch action {
	case ActionStart:
		return runDetached(ctx, "", "picoclaw", "gateway")
	case ActionStop:
		return run(ctx, "picoclaw", "gateway", "stop")
	case ActionRestart:
		_ = run(ctx, "picoclaw", "gateway", "stop")
		return runDetached(ctx, "", "picoclaw", "gateway")
	default:
		return fmt.Errorf("unsupported action %q for PicoClaw", action)
	}
}

func hermesServiceInstalled(ctx context.Context) bool {
	home := os.Getenv("HOME")
	plistPath := filepath.Join(home, "Library", "LaunchAgents", "ai.hermes.gateway.plist")
	_, err := os.Stat(plistPath)
	return err == nil
}

func serviceInstalled(ctx context.Context, framework string) bool {
	switch framework {
	case "zeroclaw":
		statusCmd := exec.CommandContext(ctx, config.LookPathEnriched("zeroclaw"), "service", "status")
		statusCmd.Env = config.EnrichedEnv()
		out, err := statusCmd.CombinedOutput()
		if err != nil {
			return false
		}
		s := string(out)
		return !strings.Contains(s, "not loaded") && !strings.Contains(s, "not installed")
	default:
		return true
	}
}

func run(ctx context.Context, command string, args ...string) error {
	cmd := exec.CommandContext(ctx, config.LookPathEnriched(command), args...)
	cmd.Env = config.EnrichedEnv()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %w\n%s", command, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func runDetachedWithNode22(ctx context.Context, logDir string, command string, args ...string) error {
	return runDetachedWithEnv(ctx, logDir, node22Env(), command, args...)
}

func runDetached(ctx context.Context, logDir string, command string, args ...string) error {
	return runDetachedWithEnv(ctx, logDir, nil, command, args...)
}

func runDetachedWithEnv(_ context.Context, logDir string, env []string, command string, args ...string) error {
	cmd := exec.Command(config.LookPathEnriched(command), args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if env != nil {
		cmd.Env = env
	} else {
		cmd.Env = config.EnrichedEnv()
	}

	var logFile *os.File
	if logDir != "" {
		if err := os.MkdirAll(logDir, 0o755); err != nil {
			fmt.Fprintf(os.Stderr, "eyrie: failed to create log dir %s: %v\n", logDir, err)
		} else {
			logPath := filepath.Join(logDir, "daemon.stdout.log")
			if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err != nil {
				fmt.Fprintf(os.Stderr, "eyrie: failed to open log file %s: %v\n", logPath, err)
			} else {
				cmd.Stdout = f
				cmd.Stderr = f
				logFile = f
			}
		}
	}

	if err := cmd.Start(); err != nil {
		if logFile != nil {
			logFile.Close()
		}
		return fmt.Errorf("%s %s: %w", command, strings.Join(args, " "), err)
	}

	go func() {
		_ = cmd.Wait()
		if logFile != nil {
			logFile.Close()
		}
	}()
	return nil
}

func killByConfigDir(configDir string) (found bool, err error) {
	escaped := regexp.QuoteMeta(configDir)
	cmd := exec.Command("pkill", "-f", fmt.Sprintf("zeroclaw daemon --config-dir %s([[:space:]]|$)", escaped))
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return false, nil
		}
		return false, fmt.Errorf("pkill for config-dir %s: %w", configDir, err)
	}
	return true, nil
}

func processExistsByConfigDir(configDir string) (bool, error) {
	escaped := regexp.QuoteMeta(configDir)
	cmd := exec.Command("pgrep", "-f", fmt.Sprintf("zeroclaw daemon --config-dir %s([[:space:]]|$)", escaped))
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return false, nil
		}
		return false, fmt.Errorf("pgrep for config-dir %s: %w", configDir, err)
	}
	return true, nil
}

func executeLegacyWithConfigEnv(ctx context.Context, framework, configPath string, action LifecycleAction, extraEnv []string) error {
	switch framework {
	case "zeroclaw":
		configDir := filepath.Dir(configPath)
		logDir := filepath.Join(configDir, "logs")
		switch action {
		case ActionStart:
			_, _ = killByConfigDir(configDir)
			return runDetachedWithEnv(ctx, logDir, mergeEnv(extraEnv), "zeroclaw", "daemon", "--config-dir", configDir)
		case ActionStop:
			_, err := killByConfigDir(configDir)
			return err
		case ActionRestart:
			if _, stopErr := killByConfigDir(configDir); stopErr != nil {
				fmt.Fprintf(os.Stderr, "eyrie: zeroclaw stop (config-dir %s): %v\n", configDir, stopErr)
			}
			for i := 0; i < 10; i++ {
				time.Sleep(100 * time.Millisecond)
				found, err := processExistsByConfigDir(configDir)
				if err != nil || !found {
					break
				}
			}
			if still, _ := processExistsByConfigDir(configDir); still {
				return fmt.Errorf("old process for config-dir %s still running after 1s — not starting duplicate", configDir)
			}
			return runDetachedWithEnv(ctx, logDir, mergeEnv(extraEnv), "zeroclaw", "daemon", "--config-dir", configDir)
		default:
			return fmt.Errorf("unknown action %q for zeroclaw", action)
		}
	case "openclaw":
		ocLogDir := filepath.Join(filepath.Dir(configPath), "logs")
		env := mergeEnv(extraEnv)
		env = append(env, "OPENCLAW_CONFIG_PATH="+configPath)
		if n22 := node22BinDir(); n22 != "" {
			for i, e := range env {
				if strings.HasPrefix(e, "PATH=") {
					env[i] = "PATH=" + n22 + string(os.PathListSeparator) + e[5:]
					break
				}
			}
		}
		if action == ActionStart || action == ActionRestart {
			if action == ActionRestart {
				if err := stopOpenClawGateway(ctx); err != nil {
					fmt.Fprintf(os.Stderr, "eyrie: openclaw stop before restart: %v\n", err)
				}
			}
			return runDetachedWithEnv(ctx, ocLogDir, env, "openclaw", "gateway", "run")
		}
		return stopOpenClawGateway(ctx)
	case "hermes":
		if action == ActionStart || action == ActionRestart {
			hLogDir := filepath.Join(filepath.Dir(configPath), "logs")
			return runDetachedWithEnv(ctx, hLogDir, mergeEnv(extraEnv), "hermes", "gateway", string(action), "--config", configPath)
		}
		return run(ctx, "hermes", "gateway", string(action), "--config", configPath)
	case "picoclaw":
		pcLogDir := filepath.Join(filepath.Dir(configPath), "logs")
		switch action {
		case ActionStart:
			return runDetachedWithEnv(ctx, pcLogDir, mergeEnv(extraEnv), "picoclaw", "gateway", "--config", configPath)
		case ActionStop:
			return run(ctx, "picoclaw", "gateway", "stop", "--config", configPath)
		case ActionRestart:
			_ = run(ctx, "picoclaw", "gateway", "stop", "--config", configPath)
			return runDetachedWithEnv(ctx, pcLogDir, mergeEnv(extraEnv), "picoclaw", "gateway", "--config", configPath)
		default:
			return fmt.Errorf("unknown action %q for picoclaw", action)
		}
	case "embedded":
		return nil
	case "codex":
		return nil
	default:
		return fmt.Errorf("unknown framework %q", framework)
	}
}

func mergeEnv(extraEnv []string) []string {
	env := config.EnrichedEnv()
	if len(extraEnv) == 0 {
		return env
	}
	return append(env, extraEnv...)
}

func executeLegacyWithConfig(ctx context.Context, framework, configPath string, action LifecycleAction) error {
	switch framework {
	case "zeroclaw":
		configDir := filepath.Dir(configPath)
		logDir := filepath.Join(configDir, "logs")
		switch action {
		case ActionStart:
			_, _ = killByConfigDir(configDir)
			return runDetached(ctx, logDir, "zeroclaw", "daemon", "--config-dir", configDir)
		case ActionStop:
			_, err := killByConfigDir(configDir)
			return err
		case ActionRestart:
			if _, stopErr := killByConfigDir(configDir); stopErr != nil {
				fmt.Fprintf(os.Stderr, "eyrie: zeroclaw stop (config-dir %s): %v\n", configDir, stopErr)
			}
			for i := 0; i < 10; i++ {
				time.Sleep(100 * time.Millisecond)
				found, err := processExistsByConfigDir(configDir)
				if err != nil || !found {
					break
				}
			}
			if still, _ := processExistsByConfigDir(configDir); still {
				return fmt.Errorf("old process for config-dir %s still running after 1s — not starting duplicate", configDir)
			}
			return runDetached(ctx, logDir, "zeroclaw", "daemon", "--config-dir", configDir)
		default:
			return fmt.Errorf("unknown action %q for zeroclaw", action)
		}
	case "openclaw":
		ocLogDir := filepath.Join(filepath.Dir(configPath), "logs")
		env := node22Env()
		if env == nil {
			env = config.EnrichedEnv()
		}
		env = append(env, "OPENCLAW_CONFIG_PATH="+configPath)
		if action == ActionStart || action == ActionRestart {
			if action == ActionRestart {
				if err := stopOpenClawGateway(ctx); err != nil {
					fmt.Fprintf(os.Stderr, "eyrie: openclaw stop before restart: %v\n", err)
				}
			}
			return runDetachedWithEnv(ctx, ocLogDir, env, "openclaw", "gateway", "run")
		}
		return stopOpenClawGateway(ctx)
	case "hermes":
		if action == ActionStart || action == ActionRestart {
			hLogDir := filepath.Join(filepath.Dir(configPath), "logs")
			return runDetached(ctx, hLogDir, "hermes", "gateway", string(action), "--config", configPath)
		}
		return run(ctx, "hermes", "gateway", string(action), "--config", configPath)
	case "picoclaw":
		pcLogDir := filepath.Join(filepath.Dir(configPath), "logs")
		switch action {
		case ActionStart:
			return runDetached(ctx, pcLogDir, "picoclaw", "gateway", "--config", configPath)
		case ActionStop:
			return run(ctx, "picoclaw", "gateway", "stop", "--config", configPath)
		case ActionRestart:
			_ = run(ctx, "picoclaw", "gateway", "stop", "--config", configPath)
			return runDetached(ctx, pcLogDir, "picoclaw", "gateway", "--config", configPath)
		default:
			return fmt.Errorf("unknown action %q for picoclaw", action)
		}
	case "embedded":
		return nil
	case "codex":
		return nil
	default:
		return fmt.Errorf("unknown framework %q", framework)
	}
}

func CommandString(framework string, action LifecycleAction) string {
	switch framework {
	case "zeroclaw":
		return "zeroclaw service " + string(action)
	case "openclaw":
		return "openclaw gateway " + string(action)
	case "hermes":
		if action == ActionStart {
			return "hermes gateway start"
		}
		return fmt.Sprintf("adapter.%s() (PID-based)", strings.Title(string(action)))
	case "picoclaw":
		return "picoclaw gateway " + string(action)
	case "codex":
		return "codex app-server (launched per turn)"
	default:
		return fmt.Sprintf("<unknown framework %q> %s", framework, action)
	}
}
