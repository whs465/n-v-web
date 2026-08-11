export default function ServiceUnavailableNotFound() {
  return (
    <main className="fixed inset-0 z-[100] isolate overflow-hidden bg-[#f3f1eb] text-slate-900 dark:bg-[#070b12] dark:text-slate-100">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(15,23,42,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.055)_1px,transparent_1px)] [background-size:44px_44px] dark:opacity-40 dark:[background-image:linear-gradient(rgba(148,163,184,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.035)_1px,transparent_1px)]"
      />
      <div
        aria-hidden="true"
        className="absolute -right-28 -top-40 h-[34rem] w-[34rem] rounded-full bg-cyan-500/[0.10] blur-[110px] dark:bg-cyan-400/[0.07]"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-48 -left-28 h-[30rem] w-[30rem] rounded-full bg-blue-500/[0.09] blur-[120px] dark:bg-blue-700/[0.12]"
      />

      <section className="relative mx-auto flex min-h-dvh w-full max-w-6xl items-center px-6 py-16 sm:px-10 lg:px-16">
        <div className="w-full">
          <div className="mb-12 flex items-center gap-3 font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-slate-500 dark:text-slate-500">
            <span className="h-2 w-2 rounded-full bg-cyan-600 shadow-[0_0_14px_rgba(8,145,178,0.35)] dark:bg-cyan-400 dark:shadow-[0_0_16px_rgba(34,211,238,0.8)]" />
            System response
            <span className="h-px w-16 bg-slate-300 dark:bg-slate-800" />
            404
          </div>

          <div className="grid items-end gap-12 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-20">
            <div>
              <p className="mb-4 font-mono text-sm uppercase tracking-[0.2em] text-cyan-700 dark:text-cyan-300/80">
                Request unavailable
              </p>
              <h1 className="max-w-3xl text-[clamp(4.8rem,17vw,11.5rem)] font-semibold leading-[0.76] tracking-[-0.085em] text-slate-950 dark:text-white">
                404<span className="text-cyan-600 dark:text-cyan-300">.</span>
              </h1>
              <h2 className="mt-10 max-w-2xl text-3xl font-medium leading-tight tracking-[-0.035em] text-slate-900 sm:text-5xl dark:text-slate-100">
                This resource can&rsquo;t be reached.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-7 text-slate-600 sm:text-lg dark:text-slate-400">
                The page you requested is currently unavailable. Verify the
                address or try again later.
              </p>
            </div>

            <aside className="border-l border-slate-300 pl-6 font-mono text-xs leading-6 text-slate-500 lg:mb-2 dark:border-slate-800 dark:text-slate-500">
              <dl className="space-y-4">
                <div>
                  <dt className="uppercase tracking-[0.18em] text-slate-500 dark:text-slate-600">Status</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-300">HTTP 404</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.18em] text-slate-500 dark:text-slate-600">Reference</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-300">RESOURCE_NOT_FOUND</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-[0.18em] text-slate-500 dark:text-slate-600">Timestamp</dt>
                  <dd className="mt-1 text-slate-700 dark:text-slate-300">Request terminated</dd>
                </div>
              </dl>
            </aside>
          </div>
        </div>
      </section>

      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-600/50 to-transparent dark:via-cyan-400/60" />
    </main>
  )
}
