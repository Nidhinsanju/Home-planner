// The screen shown while the sign-in state is being checked. It has the same background as the
// Sign In / Sign Up pages, so switching between them never flashes, and its spinner only fades
// in after a short delay, so quick checks show nothing at all.
export default function AuthLoader({ message }: { message?: string }) {
  return (
    <div className="auth-container">
      {message
        ? <div className="auth-card auth-message">{message}</div>
        : <div className="auth-loader" role="status" aria-label="Loading"><span className="auth-spinner auth-spinner-lg" /></div>}
    </div>
  );
}
