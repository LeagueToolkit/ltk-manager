import { useMemo } from "react";

import {
  useWorkshopSearchQuery,
  useWorkshopSelectedChampions,
  useWorkshopSelectedMaps,
  useWorkshopSelectedTags,
  useWorkshopSort,
} from "../state";
import { useWorkshopProjects } from "./useWorkshopProjects";

export function useFilteredProjects() {
  const { data: projects = [] } = useWorkshopProjects();
  const searchQuery = useWorkshopSearchQuery();
  const selectedTags = useWorkshopSelectedTags();
  const selectedChampions = useWorkshopSelectedChampions();
  const selectedMaps = useWorkshopSelectedMaps();
  const sort = useWorkshopSort();

  return useMemo(() => {
    let result = projects;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (project) =>
          project.displayName.toLowerCase().includes(query) ||
          project.name.toLowerCase().includes(query),
      );
    }

    if (selectedTags.size > 0) {
      result = result.filter((p) => p.tags.some((t) => selectedTags.has(t)));
    }
    if (selectedChampions.size > 0) {
      result = result.filter((p) => p.champions.some((c) => selectedChampions.has(c)));
    }
    if (selectedMaps.size > 0) {
      result = result.filter((p) => p.maps.some((m) => selectedMaps.has(m)));
    }

    const sorted = [...result];
    const dir = sort.direction === "asc" ? 1 : -1;

    sorted.sort((a, b) => {
      switch (sort.field) {
        case "name":
          return dir * a.displayName.localeCompare(b.displayName);
        case "lastModified":
          return dir * (new Date(a.lastModified).getTime() - new Date(b.lastModified).getTime());
        default:
          return 0;
      }
    });

    return sorted;
  }, [projects, searchQuery, selectedTags, selectedChampions, selectedMaps, sort]);
}
