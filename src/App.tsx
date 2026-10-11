import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  api,
  events,
  Connection,
  PortForwardRule,
  TailcatStatus,
} from "./api";
import Sidebar from "./components/Sidebar";
import ConnectionPanel from "./components/ConnectionPanel";
import NewConnectionModal from "./components/NewConnectionModal";
import DropZone from "./components/DropZone";

export default function App() {
  const [status, setStatus] = useState<TailcatStatus | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [forwards, setForwards] = useState<PortForwardRule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [showModal, setShowModal] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const refreshForwards = useCallback(async () => {
    setForwards(await api.listForwards());
  }, []);

  useEffect(() => {
    (async () => {
      setStatus(await api.checkTailcat());
      const list = await api.listConnections();
      setConnections(list);
      if (list.length) setSelectedId((prev) => prev ?? list[0].id);
      await refreshForwards();
    })();
  }, [refreshForwards]);

  useEffect(() => {
    const unOut = events.onOutput(({ id, stream, line }) => {
      const prefix = stream === "stderr" ? "! " : "";
      setLogs((prev) => {
        const next = [...(prev[id] ?? []), prefix + line];
        return { ...prev, [id]: next.slice(-500) };
      });
    });
    const unExit = events.onExit(({ id, code }) => {
      setRunning((prev) => ({ ...prev, [id]: false }));
      setLogs((prev) => ({
        ...prev,
        [id]: [
          ...(prev[id] ?? []),
          `— процесс завершён (код ${code ?? "?"}) —`,
        ].slice(-500),
      }));
      if (code && code !== 0) notify(`Процесс завершился с кодом ${code}`);
    });

    const unForwardOut = events.onForwardOutput(({ ruleId, stream, line }) => {
      const prefix = stream === "stderr" ? "! " : "";
      setLogs((prev) => {
        const key = `forward:${ruleId}`;
        const next = [...(prev[key] ?? []), prefix + line];
        return { ...prev, [key]: next.slice(-200) };
      });
    });
    const unForwardExit = events.onForwardExit(({ code }) => {
      refreshForwards();
      if (code && code !== 0) notify(`Форвардинг остановлен (код ${code})`);
    });

    return () => {
      unOut.then((f) => f());
      unExit.then((f) => f());
      unForwardOut.then((f) => f());
      unForwardExit.then((f) => f());
    };
  }, [notify, refreshForwards]);

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedId) ?? null,
    [connections, selectedId]
  );

  useEffect(() => {
    const un = listen<string>("menu-event", (e) => {
      switch (e.payload) {
        case "new-connection":
          setShowModal(true);
          break;
        case "open-ssh":
          if (selected)
            api.openInTerminal(["ssh", ...selected.extraArgs, selected.address]);
          break;
        case "run-server":
          if (selected) handleRun(selected, "serve");
          break;
        case "stop-server":
          if (selected) handleStop(selected);
          break;
        case "send-files":
          if (selected) handlePickAndSend(selected);
          break;
      }
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((event) => {
      if (
        event.payload.type === "enter" ||
        event.payload.type === "over"
      ) {
        setDragActive(true);
      } else if (event.payload.type === "leave") {
        setDragActive(false);
      } else if (event.payload.type === "drop") {
        setDragActive(false);
        if (!selected) return;
        const { paths } = event.payload;
        if (paths.length === 0) return;
        api
          .sendFiles(selected.id, selected.address, paths)
          .then(() => notify(`Отправка ${paths.length} файл(ов)…`))
          .catch((e) => notify(`Ошибка: ${e}`));
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [selected, notify]);

  async function handleSave(conn: Connection) {
    await api.saveConnection(conn);
    const list = await api.listConnections();
    setConnections(list);
    setSelectedId(conn.id);
    setShowModal(false);
    notify(`Сохранено: ${conn.name}`);
  }

  async function handleDelete(id: string) {
    await api.deleteConnection(id);
    const list = await api.listConnections();
    setConnections(list);
    if (selectedId === id) setSelectedId(list[0]?.id ?? null);
    notify("Подключение удалено");
  }

  async function handleRun(conn: Connection, mode: string) {
    const args = [mode, ...conn.extraArgs, conn.address].filter(Boolean);
    setLogs((prev) => ({
      ...prev,
      [conn.id]: [`$ tailcat ${args.join(" ")}`],
    }));
    setRunning((prev) => ({ ...prev, [conn.id]: true }));
    try {
      await api.runTailcat(conn.id, args);
    } catch (e) {
      setRunning((prev) => ({ ...prev, [conn.id]: false }));
      setLogs((prev) => ({
        ...prev,
        [conn.id]: [...(prev[conn.id] ?? []), `Ошибка: ${e}`],
      }));
      notify(`Ошибка запуска: ${e}`);
    }
  }

  async function handleStop(conn: Connection) {
    await api.stopProcess(conn.id);
    setRunning((prev) => ({ ...prev, [conn.id]: false }));
    notify("Процесс остановлен");
  }

  async function handleOpenTerminal(conn: Connection, command: string) {
    await api.openInTerminal(
      [command, ...conn.extraArgs, conn.address].filter(Boolean)
    );
  }

  async function handlePickAndSend(conn: Connection) {
    try {
      await api.pickAndSendFiles(conn.id, conn.address);
      notify("Файлы отправлены");
    } catch (e) {
      if (e !== "Диалог отменён") notify(`Ошибка: ${e}`);
    }
  }

  return (
    <div className="app">
      <Sidebar
        connections={connections}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={() => setShowModal(true)}
        status={status}
      />
      <main className="main">
        <ConnectionPanel
          connection={selected}
          connections={connections}
          running={!!(selected && running[selected.id])}
          logs={selected ? logs[selected.id] ?? [] : []}
          forwards={forwards}
          onRun={handleRun}
          onStop={handleStop}
          onDelete={handleDelete}
          onOpenTerminal={handleOpenTerminal}
          onSendFiles={handlePickAndSend}
          onClearLogs={() =>
            selected && setLogs((prev) => ({ ...prev, [selected.id]: [] }))
          }
          onRefreshForwards={refreshForwards}
          notify={notify}
        />
      </main>

      {selected && (
        <DropZone
          visible={dragActive}
          label={`Перетащите файлы сюда, чтобы отправить через ${selected.name}`}
        />
      )}

      {showModal && (
        <NewConnectionModal
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
