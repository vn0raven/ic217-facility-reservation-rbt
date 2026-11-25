import type { User } from "../../../shared/types/index.ts";
import { formatRoleLabel } from "./time.ts";

const STORAGE_KEY = "ic217.demoActorId";

export interface ActorSession {
  getActor(): User | undefined;
  getUsers(): ReadonlyArray<User>;
  subscribe(listener: (actor: User | undefined) => void): void;
}

export async function initializeActorSelector(
  usersRequest: Promise<User[]>,
): Promise<ActorSession> {
  const select = document.querySelector<HTMLSelectElement>("#actor-select")!;
  const listeners = new Set<(actor: User | undefined) => void>();
  let users: User[] = [];
  let activeActor: User | undefined;

  function notify(): void {
    for (const listener of listeners) listener(activeActor);
  }

  select.addEventListener("change", () => {
    const chosenId = Number(select.value);
    activeActor = users.find(user => user.id === chosenId);
    if (activeActor) sessionStorage.setItem(STORAGE_KEY, String(activeActor.id));
    notify();
  });

  try {
    users = await usersRequest;
    select.replaceChildren();
    if (users.length === 0) {
      select.append(new Option("No demo users seeded", ""));
      select.disabled = true;
    } else {
      for (const user of users) {
        select.append(
          new Option(`${user.name} · ${formatRoleLabel(user.role)}`, String(user.id)),
        );
      }
      const savedId = Number(sessionStorage.getItem(STORAGE_KEY));
      activeActor = users.find(user => user.id === savedId) ?? users[0];
      select.value = String(activeActor.id);
      select.disabled = false;
    }
  } catch {
    select.replaceChildren(new Option("Users unavailable", ""));
    select.disabled = true;
  }

  notify();

  return {
    getActor: () => activeActor,
    getUsers: () => users,
    subscribe(listener) {
      listeners.add(listener);
      listener(activeActor);
    },
  };
}
