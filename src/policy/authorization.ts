export type MutationClass =
  | "read_only"
  | "networked_read_only"
  | "local_mutation"
  | "administrative"
  | "destructive_administrative";

export function requiresAdministrativeEnablement(mutationClass: MutationClass): boolean {
  return mutationClass === "administrative" || mutationClass === "destructive_administrative";
}
