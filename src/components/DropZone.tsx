type Props = {
  visible: boolean;
  label: string;
};

export default function DropZone({ visible, label }: Props) {
  if (!visible) return null;
  return (
    <div className="drop-hint" aria-hidden="true">
      <div className="drop-hint-inner">📎 {label}</div>
    </div>
  );
}
