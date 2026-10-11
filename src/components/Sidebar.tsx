import { Connection, TailcatStatus } from "../api";

type Props = {
  connections: Connection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  status: TailcatStatus | null;
};

export default function Sidebar({
  connections,
  selectedId,
  onSelect,
  onNew,
  status,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header" data-tauri-drag-region>
        <span className="sidebar-title">Tailcat</span>
      </div>

      <button className="btn-new" onClick={onNew}>
        + Новое подключение
      </button>

      <nav className="sidebar-list">
        {connections.length === 0 && (
          <div className="empty-hint">Пока нет сохранённых адресов</div>
        )}
        {connections.map((c) => (
          <button
            key={c.id}
            className={"sidebar-item" + (c.id === selectedId ? " active" : "")}
            onClick={() => onSelect(c.id)}
          >
            <span className="sidebar-item-name">{c.name}</span>
            <span className="sidebar-item-addr">
              {c.address || "•••• Keychain"}
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {status?.installed ? (
          <span className="status ok" title={status.path ?? ""}>
            ● tailcat готов{status.version ? ` · ${status.version}` : ""}
          </span>
        ) : (
          <span className="status err">● tailcat не найден</span>
        )}
      </div>
    </aside>
  );
}
