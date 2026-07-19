import type { ReactNode } from "react";

/**
 * Screen shell for auth pages — centered card on a subtle purple wash.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-white to-white flex items-center justify-center p-4">
      {children}
    </div>
  );
}

export default AuthLayout;
