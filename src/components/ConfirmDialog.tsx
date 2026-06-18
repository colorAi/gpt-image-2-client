import type { ConfirmRequest } from "../types";

export default function ConfirmDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: ConfirmRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!request) return null;
  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onClick={onCancel}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" onClick={(event) => event.stopPropagation()}>
        <h3 id="confirm-dialog-title">{request.title}</h3>
        <p>{request.message}</p>
        <div className="confirm-actions">
          <button className="btn" type="button" onClick={onCancel}>{request.cancelLabel || "取消"}</button>
          <button className="btn danger" type="button" onClick={onConfirm}>{request.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
