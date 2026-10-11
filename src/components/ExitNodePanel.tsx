import { useEffect, useState } from "react";
import { api, Connection } from "../api";

type Props = {
  connection: Connection;
  notify: (msg: string) => void;
};

export default function ExitNodePanel({ connection, notify }: Props) {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getExitNodeStatus(connection.id).then(setActive);
  }, [connection.id]);

  async function toggle() {
    setLoading(true);
    try {
      if (active) {
        await api.stopExitNode(connection.id);
        setActive(false);
        notify("Exit-node остановлен");
      } else {
        await api.startExitNode(
          connection.id,
          connection.address,
          connection.extraArgs
        );
        setActive(true);
        notify("Exit-node запущен");
      }
    } catch (e) {
      notify(`Ошибка: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="exit-node-panel">
      <div className="exit-node-header">
        <h3>Exit-node</h3>
        <span className={"status-badge" + (active ? " active" : "")}>
          {active ? "Активен" : "Неактивен"}
        </span>
      </div>

      <p className="exit-node-desc">
        Использовать этот сервер для маршрутизации трафика через exit-node.
        Весь трафик клиентов будет выходить через этот узел.
      </p>

      <button
        className={"btn " + (active ? "danger" : "primary")}
        onClick={toggle}
        disabled={loading}
      >
        {loading ? "…" : active ? "Остановить exit-node" : "Запустить exit-node"}
      </button>

      <div className="exit-node-hint">
        <strong>Для клиентов:</strong> подключитесь к адресу и используйте
        форвардинг через exit-node:
        <code>tailcat forward --exit-node {connection.address} ...</code>
      </div>
    </div>
  );
}
