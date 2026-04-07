export default function Toast({ toast }) {
  if (!toast) return null;

  return (
    <div className={`toast show ${toast.type || 'info'}`} role="alert" aria-live="assertive">
      {toast.msg}
    </div>
  );
}
