import { useEffect, useRef, useState } from "react";
import { Connection, PortForwardRule } from "../api";
import PortForwardPanel from "./PortForwardPanel";
import ExitNodePanel from "./ExitNodePanel";

type Props = {
  connection: Connection | null;
  connections: Connection[];
  running: boolean;
  logs: string[];
  forwards: PortForwardRule[];
  onRun: (c: Connection, mode: string) => void;
  onStop: (c: Connection) => void;
  onDelete: (id: string) => void;
  onOpenTerminal: (c: Connection, command: string) => void;
  onSendFiles: (c: Connection) => void;
  onClearLogs: () => void;
  onRefreshForwards: () => void;
  notify: (msg: string) => void;
};

type Tab = "actions" | "forwards" | "exit-node" | "console";

export default function ConnectionPanel({
  connection,
  connections,
  running,
  logs,
  forwards,
  onRun,
  onStop,
  onDelete,
  onOpenTerminal,
  onSendFiles,
  onClearLogs,
  onRefreshForwards,
  notify,
}: Props) {
  const [tab, setTab] = useState<Tab>("actions");
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, tab]);

  if (!connection) {
    return (
      <div className="empty-state">
        <h2>Добро пожаловать в Tailcat</h2>
        <p>Создайте подключение слева, чтобы начать.</p>
      </div>
    );
  }

  const activeForwards = forwards.filter(
    (r) => r.connectionIds.includes(connection.id) && r.active
  ).length;

  return (
    <div className="panel">
      <header className="panel-header" data-tauri-drag-region>
        <div>
          <h1>{connection.name}</h1>
          <div className="address-row">
            <code>{connection.address || "•••• (Keychain)"}</code>
            {connection.address && (
              <button
                className="icon-btn"
                title="Скопировать"
                onClick={() =>
                  navigator.clipboard.writeText(connection.address)
                }
              >
                ⧉
              </button>
            )}
            {connection.isExitNode && (
              <span className="exit-node-badge">Exit-node</span>
            )}
          </div>
        </div>
        <button
          className="btn-danger-ghost"
          onClick={() => onDelete(connection.id)}
        >
          Удалить
        </button>
      </header>

      <nav className="tabs">
        <button
          className={"tab" + (tab === "actions" ? " active" : "")}
          onClick={() => setTab("actions")}
        >
          Действия
        </button>
        <button
          className={"tab" + (tab === "forwards" ? " active" : "")}
          onClick={() => setTab("forwards")}
        >
          Порты
          {activeForwards > 0 && (
            <span className="tab-badge">{activeForwards}</span>
          )}
        </button>
        <button
          className={"tab" + (tab === "exit-node" ? " active" : "")}
          onClick={() => setTab("exit-node")}
        >
          Exit-node
        </button>
        <button
          className={"tab" + (tab === "console" ? " active" : "")}
          onClick={() => setTab("console")}
        >
          Консоль
        </button>
      </nav>

      <div className="tab-content">
        {tab === "actions" && (
          <section className="actions">
            <button
              className="btn primary"
              onClick={() => onOpenTerminal(connection, "ssh")}
            >
              Открыть SSH
            </button>
            <button
              className="btn"
              disabled={running}
              onClick={() => onRun(connection, "serve")}
            >
              Serve
            </button>
            <button
              className="btn"
              disabled={running}
              onClick={() => onRun(connection, "recv")}
            >
              Recv
            </button>
            <button
              className="btn"
              disabled={running}
              onClick={() => onRun(connection, "files")}
            >
              Files
            </button>
            <button className="btn" onClick={() => onSendFiles(connection)}>
              Отправить файлы…
            </button>
            {running && (
              <button
                className="btn danger"
                onClick={() => onStop(connection)}
              >
                Остановить
              </button>
            )}
          </section>
        )}

        {tab === "forwards" && (
          <PortForwardPanel
            connections={connections}
            rules={forwards}
            onRefresh={onRefreshForwards}
            notify={notify}
          />
        )}

        {tab === "exit-node" && (
          <ExitNodePanel connection={connection} notify={notify} />
        )}

        {tab === "console" && (
          <section className="console-wrap">
            <div className="console-header">
              <span>Вывод</span>
              <button className="icon-btn" onClick={onClearLogs}>
                Очистить
              </button>
            </div>
            <div className="console" ref={consoleRef}>
              {logs.length === 0 && (
                <div className="console-empty">
                  Здесь появится вывод tailcat…
                </div>
              )}
              {logs.map((l, i) => (
                <div
                  key={i}
                  className={
                    "console-line" + (l.startsWith("! ") ? " err" : "")
                  }
                >
                  {l}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
