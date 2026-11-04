import type {
  SSHConnectionConfig,
  TerminalSize,
  FileEntry,
  TransferProgress,
  LocalVaultDocument,
} from '@magicterm/shared';
import type { PortForwardPreset, PortForwardStatus } from '../../common/port-forward';
import type { DiscoveredService, DiscoveryResult } from '../../common/monitor/types';
import type { LiveSample } from '../../common/monitor/live';
import type { ActionRequest, ActionResult } from '../../common/monitor/actions';
import type { DeployRunEvent, DeployScenario } from '../../common/monitor/deploy';

export type SSHDataCallback = (sessionId: string, data: string) => void;
export type SSHStatusCallback = (sessionId: string, status: string, error?: string) => void;
export type TransferProgressCallback = (progress: TransferProgress) => void;

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes?: string;
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: number;
  error?: string;
}

export type UpdateStatusCallback = (status: UpdateStatus) => void;

export type HostKeyChallenge =
  | {
      success: false;
      code: 'host_key_unknown';
      host: string;
      port: number;
      fingerprint: string;
    }
  | {
      success: false;
      code: 'host_key_mismatch';
      host: string;
      port: number;
      fingerprint: string;
      storedFingerprint: string;
    };

export type ConnectFailure = { success: false; error: string; cancelled?: boolean };

export type SshConnectResult = { success: true } | HostKeyChallenge | ConnectFailure;

export type SftpConnectResult =
  | { success: true; homePath: string }
  | HostKeyChallenge
  | ConnectFailure;

export interface ElectronAPI {
  ssh: {
    connect: (sessionId: string, config: SSHConnectionConfig) => Promise<SshConnectResult>;
    disconnect: (sessionId: string) => Promise<{ success: boolean }>;
    sendData: (sessionId: string, data: string) => Promise<void>;
    resize: (sessionId: string, size: TerminalSize) => Promise<{ applied: boolean; queued: boolean }>;
    onData: (callback: SSHDataCallback) => () => void;
    onStatus: (callback: SSHStatusCallback) => () => void;
  };
  portForward: {
    /** `key` is the tab id. Forwards of one tab share one SSH connection. */
    start: (key: string, config: SSHConnectionConfig, preset: PortForwardPreset) => Promise<PortForwardStatus>;
    stop: (key: string, presetId: string) => Promise<{ success: boolean }>;
    stopAll: (key: string) => Promise<{ success: boolean }>;
    list: (key: string) => Promise<PortForwardStatus[]>;
    onStatus: (callback: (key: string, status: PortForwardStatus) => void) => () => void;
  };
  monitor: {
    /** Read-only scan over a background connection. The password, if any, goes to sudo on stdin. */
    discover: (serverId: string, config: SSHConnectionConfig, sudoPassword?: string) => Promise<{
      success: boolean;
      result?: DiscoveryResult;
      error?: string;
      /** The host key is not trusted; ask with the host-key dialog, then scan again. */
      hostKey?: HostKeyChallenge;
    }>;
    disconnect: (serverId: string) => Promise<{ success: boolean }>;
    /** Samples the server every 5 s and checks its sites every minute, over the background connection. */
    watch: (serverId: string, config: SSHConnectionConfig, discovery: DiscoveryResult) => Promise<{ success: boolean; error?: string }>;
    unwatch: (serverId: string) => Promise<{ success: boolean }>;
    checkSites: (serverId: string) => Promise<{ success: boolean }>;
    onSample: (callback: (serverId: string, sample: LiveSample) => void) => () => void;
    /** Follows a service's log; the password, if any, goes to sudo on stdin. */
    startLogs: (
      streamId: string,
      serverId: string,
      config: SSHConnectionConfig,
      service: DiscoveredService,
      options: { lines: number; sudoPassword?: string }
    ) => Promise<{ success: boolean; error?: string }>;
    stopLogs: (streamId: string) => Promise<{ success: boolean }>;
    onLogData: (callback: (streamId: string, text: string) => void) => () => void;
    onLogEnd: (callback: (streamId: string, result: { exitCode: number | null; error: string | null }) => void) => () => void;
    readLogs: (
      serverId: string,
      config: SSHConnectionConfig,
      service: DiscoveredService,
      lines: number,
      sudoPassword?: string
    ) => Promise<{ success: boolean; text?: string; truncated?: boolean; error?: string }>;
    /** Start, stop, restart, reload, nginx test or reload. The password, if any, goes to sudo on stdin. */
    action: (
      serverId: string,
      config: SSHConnectionConfig,
      request: ActionRequest,
      sudoPassword?: string
    ) => Promise<{ success: boolean; result?: ActionResult; error?: string }>;
    /** Runs a deploy scenario; output, prompts and the end arrive through onDeployEvent. */
    startDeploy: (runId: string, serverId: string, config: SSHConnectionConfig, scenario: DeployScenario) => Promise<{ success: boolean; error?: string }>;
    /** Hands the user's answer to the waiting git or sudo prompt; null makes it fail. */
    answerDeploy: (runId: string, askId: string, value: string | null) => Promise<{ success: boolean; error?: string }>;
    cancelDeploy: (runId: string) => Promise<{ success: boolean }>;
    onDeployEvent: (callback: (runId: string, event: DeployRunEvent) => void) => () => void;
  };
  auth: {
    /** @deprecated Legacy SHA-256 hash channel. Prefer masterKey.createVerifier. */
    setMasterKeyHash: (hash: string) => Promise<{ success: boolean }>;
    getStatus: () => Promise<{ hasMasterKey: boolean }>;
    logout: () => Promise<{ success: boolean }>;
  };
  servers: {
    list: () => Promise<{ servers: unknown[] }>;
    add: (server: unknown) => Promise<{ server: unknown }>;
    update: (id: string, updates: unknown) => Promise<{ id: string; updates: unknown }>;
    delete: (id: string) => Promise<{ id: string }>;
  };
  updater: {
    getPlatform: () => Promise<{ platform: string; isMac: boolean }>;
    check: () => Promise<{ success: boolean; updateInfo?: UpdateInfo; error?: string }>;
    download: () => Promise<{ success: boolean; error?: string; openedExternal?: boolean }>;
    install: () => void;
    openReleasePage: () => Promise<void>;
    onStatus: (callback: UpdateStatusCallback) => () => void;
  };
  clipboard: {
    writeText: (text: string) => Promise<{ success: boolean; error?: string }>;
    readText: () => Promise<{ success: boolean; text: string; error?: string }>;
  };
  masterPassword: {
    save: (password: string) => Promise<{ success: boolean; error?: string }>;
    get: () => Promise<{ success: boolean; password?: string }>;
    clear: () => Promise<{ success: boolean }>;
  };
  masterKey: {
    setVerifier: (verifier: string | null) => Promise<{ success: boolean; error?: string }>;
    createVerifier: (password: string) => Promise<{ success: boolean; verifier?: string; error?: string }>;
    verify: (
      password: string
    ) => Promise<{
      success: boolean;
      valid?: boolean;
      upgraded?: boolean;
      verifier?: string;
      error?: string;
    }>;
    getVerifier: () => Promise<{ verifier: string | null }>;
    checkVerifier: (password: string, verifier: string) => Promise<{ success: boolean; valid: boolean }>;
  };
  localVault: {
    status: () => Promise<{ localOnly: boolean; exists: boolean; hasVerifier: boolean }>;
    setMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
    create: () => Promise<{ success: boolean; error?: string }>;
    unlock: (password: string) => Promise<{ success: boolean; valid: boolean }>;
    open: () => Promise<{ success: boolean; vault?: LocalVaultDocument; error?: string }>;
    replace: (document: LocalVaultDocument) => Promise<{ success: boolean; error?: string }>;
    lock: () => Promise<{ success: boolean }>;
    delete: () => Promise<{ success: boolean; error?: string }>;
  };
  sshHostKeys: {
    list: () => Promise<{ hostPort: string; fingerprint: string; addedAt: string }[]>;
    trust: (host: string, port: number, fingerprint: string) => Promise<{ success: boolean; error?: string }>;
    forget: (host: string, port: number) => Promise<{ success: boolean; error?: string }>;
  };
  secureStorage: {
    get: (key: string) => Promise<{ success: boolean; value: string | null; error?: string }>;
    set: (key: string, value: string) => Promise<{ success: boolean; error?: string }>;
    remove: (key: string) => Promise<{ success: boolean; error?: string }>;
  };
  proxy: {
    get: () => Promise<{ success: boolean; config: { enabled: boolean; type: string; host: string; port: number; username?: string; password?: string } | null }>;
    set: (config: { enabled: boolean; type: string; host: string; port: number; username?: string; password?: string }) => Promise<{ success: boolean }>;
    test: () => Promise<{ success: boolean; ip?: string; error?: string }>;
  };
  terminalSettings: {
    get: () => Promise<{ success: boolean; settings: Record<string, unknown> | null }>;
    set: (settings: Record<string, unknown>) => Promise<{ success: boolean }>;
  };
  aiSettings: {
    get: () => Promise<{ success: boolean; settings: unknown }>;
    set: (settings: unknown) => Promise<{ success: boolean; error?: string }>;
  };
  ai: {
    complete: (input: {
      provider: 'openai' | 'anthropic' | 'openrouter' | 'ollama';
      model: string;
      baseUrl: string;
      apiKey: string;
      system: string;
      messages: { role: 'user' | 'assistant'; content: string }[];
      requestId?: string;
    }) => Promise<{ success: boolean; text?: string; error?: string }>;
    cancel: (requestId: string) => Promise<{ success: boolean }>;
    onDelta: (callback: (event: { requestId: string; delta: string }) => void) => () => void;
    verify: (input: {
      provider: 'openai' | 'anthropic' | 'openrouter' | 'ollama';
      model: string;
      baseUrl: string;
      apiKey: string;
    }) => Promise<{ success: boolean; error?: string }>;
  };
  mcp: {
    getSettings: () => Promise<{ success: boolean; settings: { enabled: boolean; serverIds: string[] } }>;
    setSettings: (settings: { enabled: boolean; serverIds: string[] }) => Promise<{ success: boolean; settings: { enabled: boolean; serverIds: string[] } }>;
    clientConfig: () => Promise<{ success: boolean; config: { command: string; args: string[]; env: Record<string, string> } }>;
    onCall: (callback: (call: { callId: string; name: string; args: Record<string, unknown>; client: string }) => void) => () => void;
    respond: (callId: string, result: { text: string; isError?: boolean; structured?: unknown }) => Promise<{ success: boolean }>;
    exec: (config: SSHConnectionConfig, command: string, timeoutSeconds: number) => Promise<{
      success: boolean;
      error?: string;
      result?: { exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean };
    }>;
  };
  sshConfig: {
    import: () => Promise<{ success: boolean; hosts: { name: string; host: string; port: number; username: string; identityFile?: string }[]; error?: string }>;
  };
  sftp: {
    connect: (sessionId: string, config: SSHConnectionConfig) => Promise<SftpConnectResult>;
    disconnect: (sessionId: string) => Promise<{ success: boolean }>;
    list: (
      sessionId: string,
      remotePath: string
    ) => Promise<{ success: boolean; entries?: FileEntry[]; error?: string }>;
    stat: (
      sessionId: string,
      remotePath: string
    ) => Promise<{ success: boolean; entry?: FileEntry; error?: string }>;
    download: (
      sessionId: string,
      transferId: string,
      remotePath: string,
      localPath: string
    ) => Promise<{ success: boolean; error?: string }>;
    upload: (
      sessionId: string,
      transferId: string,
      localPath: string,
      remotePath: string
    ) => Promise<{ success: boolean; error?: string }>;
    delete: (
      sessionId: string,
      remotePath: string,
      isDirectory: boolean
    ) => Promise<{ success: boolean; error?: string }>;
    rename: (
      sessionId: string,
      oldPath: string,
      newPath: string
    ) => Promise<{ success: boolean; error?: string }>;
    mkdir: (
      sessionId: string,
      remotePath: string
    ) => Promise<{ success: boolean; error?: string }>;
    readFile: (
      sessionId: string,
      remotePath: string
    ) => Promise<{ success: boolean; content?: string; error?: string }>;
    writeFile: (
      sessionId: string,
      remotePath: string,
      content: string
    ) => Promise<{ success: boolean; error?: string }>;
    pickUploadFiles: () => Promise<{ success: boolean; canceled?: boolean; files: string[] }>;
    pickDownloadDestination: (
      suggestedName: string
    ) => Promise<{ success: boolean; canceled?: boolean; filePath?: string }>;
    onProgress: (callback: TransferProgressCallback) => () => void;
  };
  localFs: {
    getHome: () => Promise<{ success: boolean; path?: string }>;
    list: (
      dirPath: string
    ) => Promise<{ success: boolean; entries?: FileEntry[]; error?: string }>;
    openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    reveal: (filePath: string) => Promise<{ success: boolean }>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
  
  const __APP_VERSION__: string;
}

export { };
