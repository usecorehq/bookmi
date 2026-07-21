import type { ReactNode } from "react";

/**
 * Screen shell for auth pages — centered card on a subtle purple wash.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-light to-white flex items-center justify-center p-4">
      <div className="anim-fade-up w-full flex items-center justify-center">{children}</div>
    </div>
  );
}

export default AuthLayout;
