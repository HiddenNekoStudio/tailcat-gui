import { useState } from "react";
import { api, Connection, PortForwardRule } from "../api";
import TrafficMonitor from "./TrafficMonitor";

type Props = {
  connections: Connection[];
  rules: PortForwardRule[];
  onRefresh: () => void;
  notify: (msg: string) => void;
};

export default function PortForwardPanel({
  connections,
  rules,
  onRefresh,
  notify,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<PortForwardRule | null>(null);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);

  async function handleStart(rule: PortForwardRule) {
    try {
      if (rule.isGroup) {
        const addresses: Record<string, string> = {};
        for (const cid of rule.connectionIds) {
          const conn = connections.find((c) => c.id === cid);
          if (conn) addresses[cid] = conn.address;
        }
        const results = await api.startGroupForward(rule, addresses);
        notify(`Групповое правило запущено:\n${results.join("\n")}`);
      } else {
        const conn = connections.find((c) => c.id === rule.connectionIds[0]);
        if (!conn) throw new Error("Подключение не найдено");
        const actualPort = await api.startForward(rule, conn.address);
        notify(
          `Форвардинг запущен: localhost:${actualPort || rule.localPort} → :${rule.remotePort}`
        );
      }
      onRefresh();
    } catch (e) {
      notify(`Ошибка: ${e}`);
    }
  }

  async function handleStop(rule: PortForwardRule) {
    if (rule.isGroup) {
      await api.stopGroupForward(rule.id);
    } else {
      await api.stopForward(rule.id);
    }
    notify("Форвардинг остановлен");
    onRefresh();
  }

  async function handleDelete(rule: PortForwardRule) {
    await api.deleteForwardRule(rule.id);
    notify("Правило удалено");
    onRefresh();
  }

  return (
    <div className="forward-panel">
      <div className="forward-header">
        <h3>Форвардинг портов</h3>
        <button
          className="btn primary small"
          onClick={() => {
            setEditingRule(null);
            setShowForm(true);
          }}
        >
          + Добавить
        </button>
      </div>

      {rules.length === 0 && (
        <div className="empty-hint">
          Нет правил форвардинга. Добавьте первое правило, чтобы пробросить
          порт.
        </div>
      )}

      <div className="forward-list">
        {rules.map((rule) => (
          <div key={rule.id}>
            <PortForwardCard
              rule={rule}
              connections={connections}
              onStart={() => handleStart(rule)}
              onStop={() => handleStop(rule)}
              onDelete={() => handleDelete(rule)}
              onEdit={() => {
                setEditingRule(rule);
                setShowForm(true);
              }}
              onToggleMonitor={() =>
                setExpandedRule(expandedRule === rule.id ? null : rule.id)
              }
              expanded={expandedRule === rule.id}
            />
            {expandedRule === rule.id && rule.active && (
              <TrafficMonitor
                ruleId={rule.id}
                ruleLabel={
                  rule.description || `${rule.localPort} → ${rule.remotePort}`
                }
              />
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <PortForwardForm
          connections={connections}
          initial={editingRule}
          onClose={() => setShowForm(false)}
          onSave={async (rule) => {
            await api.saveForwardRule(rule);
            setShowForm(false);
            onRefresh();
            notify("Правило сохранено");
          }}
        />
      )}
    </div>
  );
}

function PortForwardCard({
  rule,
  connections,
  onStart,
  onStop,
  onDelete,
  onEdit,
  onToggleMonitor,
  expanded,
}: {
  rule: PortForwardRule;
  connections: Connection[];
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onToggleMonitor: () => void;
  expanded: boolean;
}) {
  const names = rule.connectionIds
    .map((id) => connections.find((c) => c.id === id)?.name || id)
    .join(", ");

  return (
    <div className={"forward-card" + (rule.active ? " active" : "")}>
      <div className="forward-card-info">
        <div className="forward-ports">
          <span className="port-badge local">
            {rule.localPort === 0 ? "auto" : rule.localPort}
          </span>
          <span className="arrow">→</span>
          <span className="port-badge remote">{rule.remotePort}</span>
          {rule.isGroup && <span className="group-badge">группа</span>}
        </div>
        {rule.description && (
          <div className="forward-desc">{rule.description}</div>
        )}
        <div className="forward-connections" title={names}>
          {names}
        </div>
      </div>
      <div className="forward-actions">
        {rule.active ? (
          <button className="btn small danger" onClick={onStop}>
            Стоп
          </button>
        ) : (
          <button className="btn small primary" onClick={onStart}>
            Запуск
          </button>
        )}
        <button
          className={"icon-btn" + (expanded ? " active" : "")}
          onClick={onToggleMonitor}
          title="Мониторинг трафика"
        >
          📊
        </button>
        <button className="icon-btn" onClick={onEdit} title="Редактировать">
          ✎
        </button>
        <button className="icon-btn danger" onClick={onDelete} title="Удалить">
          ✕
        </button>
      </div>
    </div>
  );
}

function PortForwardForm({
  connections,
  initial,
  onClose,
  onSave,
}: {
  connections: Connection[];
  initial: PortForwardRule | null;
  onClose: () => void;
  onSave: (rule: PortForwardRule) => void;
}) {
  const [localPort, setLocalPort] = useState(initial?.localPort ?? 0);
  const [remotePort, setRemotePort] = useState(initial?.remotePort ?? 8080);
  const [target, setTarget] = useState(initial?.target ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [openBrowser, setOpenBrowser] = useState(initial?.openBrowser ?? false);
  const [selectedConns, setSelectedConns] = useState<string[]>(
    initial?.connectionIds ?? []
  );

  function toggleConn(id: string) {
    setSelectedConns((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedConns.length === 0) return;
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      connectionIds: selectedConns,
      localPort,
      remotePort,
      target: target.trim() || undefined,
      active: initial?.active ?? false,
      openBrowser,
      description: description.trim(),
      isGroup: selectedConns.length > 1,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>
          {initial ? "Редактировать правило" : "Новое правило форвардинга"}
        </h2>

        <label>
          Подключения
          <div className="conn-checklist">
            {connections.map((c) => (
              <label key={c.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selectedConns.includes(c.id)}
                  onChange={() => toggleConn(c.id)}
                />
                <span>{c.name}</span>
                <small>{c.address || "Keychain"}</small>
              </label>
            ))}
          </div>
        </label>

        {selectedConns.length > 1 && (
          <div className="group-hint">
            Будет создано групповое правило для {selectedConns.length}{" "}
            подключений. Каждое подключение запустит отдельный процесс forward.
          </div>
        )}

        <label>
          Локальный порт (0 = авто)
          <input
            type="number"
            min={0}
            max={65535}
            value={localPort}
            onChange={(e) => setLocalPort(Number(e.target.value))}
          />
        </label>

        <label>
          Удалённый порт
          <input
            type="number"
            min={1}
            max={65535}
            value={remotePort}
            onChange={(e) => setRemotePort(Number(e.target.value))}
          />
        </label>

        <label>
          Целевой адрес (опционально, для exit-node)
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="192.168.1.100:3306"
          />
        </label>

        <label>
          Описание
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="MySQL на домашнем сервере"
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={openBrowser}
            onChange={(e) => setOpenBrowser(e.target.checked)}
          />
          <span>Открыть браузер при запуске</span>
        </label>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn primary">
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}
