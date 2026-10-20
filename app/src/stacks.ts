// A PR is stacked on another when its base branch is the other's head branch (in the same repo).
export type Stackable = { id: string; repo: string; headRepo: string; head: string; base: string };

// Stacks of two or more PRs, each ordered bottom → top. Only PRs present in `items` are linked,
// so a stack with a layer missing from the list shows up as separate pieces.
export function findStacks<T extends Stackable>(items: T[]): T[][] {
  const byHead = new Map(items.map((i) => [`${i.headRepo}:${i.head}`, i]));
  const parent = (i: T) => byHead.get(`${i.repo}:${i.base}`);
  const children = Map.groupBy(items.filter(parent), (i) => parent(i)!.id);
  return items
    .filter((i) => !parent(i) && children.has(i.id))
    .map((root) => {
      const stack: T[] = [];
      const walk = (i: T) => {
        stack.push(i);
        for (const c of children.get(i.id) ?? []) walk(c);
      };
      walk(root);
      return stack;
    });
}
