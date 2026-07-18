export function LandingPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
          Bookmi <span className="opacity-50">·</span> by Qorelly
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          Your bookable page,{" "}
          <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            in one link.
          </span>
        </h1>
        <p className="text-muted-foreground text-lg">
          Share <span className="font-mono text-foreground">bookmi.co/you</span>. Let anyone book
          your services and pay in seconds — powered by Monnify.
        </p>
        <div className="text-xs text-muted-foreground pt-4 border-t border-border/60">
          Scaffold live. Signup / dashboard / public page arrive next.
        </div>
      </div>
    </main>
  );
}
