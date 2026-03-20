import { open } from "@tauri-apps/plugin-dialog";
import { Image, Pencil, Trash2 } from "lucide-react";

import { Button, Menu, useToast } from "@/components";
import type { WorkshopProject } from "@/lib/tauri";
import {
  useProjectThumbnail,
  useRemoveProjectThumbnail,
  useSetProjectThumbnail,
} from "@/modules/workshop";

interface ThumbnailSectionProps {
  project: WorkshopProject;
}

export function ThumbnailSection({ project }: ThumbnailSectionProps) {
  const { data: thumbnailUrl } = useProjectThumbnail(project.path, project.thumbnailPath);
  const setThumbnail = useSetProjectThumbnail();
  const removeThumbnail = useRemoveProjectThumbnail();
  const toast = useToast();

  async function handleSetThumbnail() {
    const file = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: ["webp", "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "ico"],
        },
      ],
    });
    if (file) {
      setThumbnail.mutate(
        { projectPath: project.path, imagePath: file },
        { onError: (err) => toast.error(`Failed to set thumbnail: ${err.message}`) },
      );
    }
  }

  function handleRemoveThumbnail() {
    removeThumbnail.mutate(
      { projectPath: project.path },
      {
        onSuccess: () => toast.success("Thumbnail removed"),
        onError: (err) => toast.error(`Failed to remove thumbnail: ${err.message}`),
      },
    );
  }

  return (
    <div className="shrink-0 space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-surface-600 bg-linear-to-br from-surface-700 to-surface-800 md:w-56">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt="Project thumbnail"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Image className="h-10 w-10 text-surface-500" />
          </div>
        )}
      </div>
      {project.thumbnailPath ? (
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                variant="outline"
                size="sm"
                left={<Pencil className="h-3.5 w-3.5" />}
                loading={setThumbnail.isPending || removeThumbnail.isPending}
              >
                Edit
              </Button>
            }
          />
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup>
                <Menu.Item icon={<Image className="h-4 w-4" />} onClick={handleSetThumbnail}>
                  Change
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item
                  icon={<Trash2 className="h-4 w-4" />}
                  variant="danger"
                  onClick={handleRemoveThumbnail}
                >
                  Remove
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : (
        <Button
          variant="outline"
          size="sm"
          left={<Image className="h-4 w-4" />}
          onClick={handleSetThumbnail}
          loading={setThumbnail.isPending}
        >
          Set Thumbnail
        </Button>
      )}
    </div>
  );
}
