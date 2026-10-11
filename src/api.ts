import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Connection = {
  id: string;
  name: string;
  address: string;
  mode: string;
  extraArgs: string[];
  lastUsed?: number | null;
  isServer: boolean;
  autostart: boolean;
  useKeychain: boolean;
  isExitNode: boolean;
};

export type PortForwardRule = {
  id: string;
  connectionIds: string[];
  localPort: number;
  remotePort: number;
  target?: string;
  active: boolean;
  openBrowser: boolean;
  description: string;
  isGroup: boolean;
};

export type TailcatStatus = {
  installed: boolean;
  version?: string | null;
  path?: string | null;
};

export type TrafficPoint = {
  timestamp: number;
  sent: number;
  received: number;
};

export type TrafficStats = {
  bytesSent: number;
  bytesReceived: number;
  connections: number;
  lastUpdated: number;
  history: TrafficPoint[];
};

export const api = {
  checkTailcat: () => invoke<TailcatStatus>("check_tailcat"),
  listConnections: () => invoke<Connection[]>("list_connections"),
  saveConnection: (connection: Connection) =>
    invoke<void>("save_connection", { connection }),
  deleteConnection: (id: string) => invoke<void>("delete_connection", { id }),
  runTailcat: (id: string, args: string[]) =>
    invoke<void>("run_tailcat", { id, args }),
  stopProcess: (id: string) => invoke<void>("stop_process", { id }),
  openInTerminal: (args: string[]) =>
    invoke<void>("open_in_terminal", { args }),
  sendFiles: (id: string, address: string, files: string[]) =>
    invoke<void>("send_files", { id, address, files }),
  pickAndSendFiles: (id: string, address: string) =>
    invoke<void>("pick_and_send_files", { id, address }),
  registerDroppedFiles: (id: string, files: string[]) =>
    invoke<void>("register_dropped_files", { id, files }),
  takeDroppedFiles: (id: string) =>
    invoke<string[]>("take_dropped_files", { id }),

  startForward: (rule: PortForwardRule, address: string) =>
    invoke<number>("start_forward", { rule, address }),
  stopForward: (ruleId: string) => invoke<void>("stop_forward", { ruleId }),
  listForwards: () => invoke<PortForwardRule[]>("list_forwards"),
  saveForwardRule: (rule: PortForwardRule) =>
    invoke<void>("save_forward_rule", { rule }),
  deleteForwardRule: (ruleId: string) =>
    invoke<void>("delete_forward_rule", { ruleId }),

  startGroupForward: (rule: PortForwardRule, addresses: Record<string, string>) =>
    invoke<string[]>("start_group_forward", { rule, addresses }),
  stopGroupForward: (ruleId: string) =>
    invoke<void>("stop_group_forward", { ruleId }),

  getTrafficStats: (ruleId: string) =>
    invoke<TrafficStats>("get_traffic_stats", { ruleId }),
  getAllTrafficStats: () =>
    invoke<Record<string, TrafficStats>>("get_all_traffic_stats"),
  resetTrafficStats: (ruleId: string) =>
    invoke<void>("reset_traffic_stats", { ruleId }),

  startExitNode: (id: string, address: string, extraArgs: string[]) =>
    invoke<void>("start_exit_node", { id, address, extraArgs }),
  stopExitNode: (id: string) => invoke<void>("stop_exit_node", { id }),
  getExitNodeStatus: (id: string) =>
    invoke<boolean>("get_exit_node_status", { id }),
  checkExitNodeCapable: (address: string) =>
    invoke<boolean>("check_exit_node_capable", { address }),

  onTrafficUpdate: (cb: (e: { ruleId: string; stats: TrafficStats }) => void) =>
    listen<{ ruleId: string; stats: TrafficStats }>("traffic-update", (e) =>
      cb(e.payload)
    ),
};

export type TailcatOutputEvent = {
  id: string;
  stream: "stdout" | "stderr";
  line: string;
};

export type TailcatExitEvent = { id: string; code: number | null };

export type ForwardOutputEvent = {
  ruleId: string;
  stream: "stdout" | "stderr";
  line: string;
};

export type ForwardExitEvent = { ruleId: string; code: number | null };

export const events = {
  onOutput: (cb: (e: TailcatOutputEvent) => void) =>
    listen<TailcatOutputEvent>("tailcat-output", (e) => cb(e.payload)),
  onExit: (cb: (e: TailcatExitEvent) => void) =>
    listen<TailcatExitEvent>("tailcat-exit", (e) => cb(e.payload)),
  onForwardOutput: (cb: (e: ForwardOutputEvent) => void) =>
    listen<ForwardOutputEvent>("forward-output", (e) => cb(e.payload)),
  onForwardExit: (cb: (e: ForwardExitEvent) => void) =>
    listen<ForwardExitEvent>("forward-exit", (e) => cb(e.payload)),
};
