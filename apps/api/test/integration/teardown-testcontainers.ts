export default async function teardown(): Promise<void> {
  await globalThis.__PG_CONTAINER__?.stop({ remove: true, removeVolumes: true });
  globalThis.__PG_CONTAINER__ = undefined;
}
