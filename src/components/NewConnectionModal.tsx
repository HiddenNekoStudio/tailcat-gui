import { useState } from "react";
import { Connection } from "../api";

type Props = {
  onClose: () => void;
  onSave: (c: Connection) => void;
};

export default function NewConnectionModal({ onClose, onSave }: Props) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState("ssh");
  const [extra, setExtra] = useState("");
  const [isServer, setIsServer] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [useKeychain, setUseKeychain] = useState(true);
  const [isExitNode, setIsExitNode] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;
    onSave({
      id: crypto.randomUUID(),
      name: name.trim(),
      address: address.trim(),
      mode,
      extraArgs: extra.trim() ? extra.trim().split(/\s+/) : [],
      lastUsed: null,
      isServer,
      autostart: isServer && autostart,
      useKeychain,
      isExitNode,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2>Новое подключение</h2>

        <label>
          Название
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Домашний сервер"
          />
        </label>

        <label>
          Адрес tailcat
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="tcXXXXXXXXX"
          />
        </label>

        <label>
          Режим по умолчанию
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="ssh">ssh</option>
            <option value="serve">serve</option>
            <option value="recv">recv</option>
            <option value="files">files</option>
          </select>
        </label>

        <label>
          Доп. аргументы
          <input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="--ssh-authorized-keys=…"
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={useKeychain}
            onChange={(e) => setUseKeychain(e.target.checked)}
          />
          <span>Хранить адрес в Keychain (рекомендуется)</span>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={isServer}
            onChange={(e) => setIsServer(e.target.checked)}
          />
          <span>Это серверный профиль (запускает serve)</span>
        </label>

        {isServer && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
            />
            <span>Автозапуск сервера при старте приложения</span>
          </label>
        )}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={isExitNode}
            onChange={(e) => setIsExitNode(e.target.checked)}
          />
          <span>Это exit-node (маршрутизация трафика)</span>
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
