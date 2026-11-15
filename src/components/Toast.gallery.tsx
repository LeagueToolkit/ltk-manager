import { Button } from "./Button";
import type { GalleryEntry } from "./galleryEntry";
import { useToast } from "./Toast";

function Types() {
  const toast = useToast();

  return (
    <>
      <Button variant="outline" onClick={() => toast.info("Library scanned", "42 mods found.")}>
        Info
      </Button>
      <Button variant="outline" onClick={() => toast.success("Mod installed", "Fiora VFX")}>
        Success
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.warning("Two mods edit the same file", "The later one wins.")}
      >
        Warning
      </Button>
      <Button
        variant="outline"
        onClick={() => toast.error("Install failed", "The archive could not be read.")}
      >
        Error
      </Button>
    </>
  );
}

function Actions() {
  const toast = useToast();

  return (
    <Button
      variant="outline"
      onClick={() =>
        toast.toast({
          title: "Mod removed",
          description: "Fiora VFX left the library.",
          actions: [
            { label: "Undo", onClick: () => {} },
            { label: "Open folder", onClick: () => {} },
          ],
        })
      }
    >
      With actions
    </Button>
  );
}

function Task() {
  const toast = useToast();

  return (
    <Button
      variant="outline"
      onClick={() => {
        const task = toast.task("Checking mods", "Starting", {
          label: "Stop",
          onClick: () => {},
        });
        task.report(40, "17 of 42");
        window.setTimeout(task.close, 4000);
      }}
    >
      Running task
    </Button>
  );
}

function Stack() {
  const toast = useToast();

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          for (const title of ["First", "Second", "Third", "Fourth", "Fifth"]) {
            toast.info(title, "The oldest closes for the fifth.");
          }
        }}
      >
        Five timed
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          for (const title of ["First", "Second", "Third", "Fourth", "Fifth"]) {
            toast.error(`${title} failure`, "The oldest goes to the notification center.");
          }
        }}
      >
        Five errors
      </Button>
    </>
  );
}

function Failures() {
  const toast = useToast();

  return (
    <>
      <Button
        variant="outline"
        onClick={() =>
          toast.failure("Could not save the file", {
            code: "IO",
            detail: "There is not enough space on the disk. (os error 112)",
            ref: "ab12cd34",
          })
        }
      >
        Unexpected error
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast.failure("Could not start the patcher", {
            code: "LEAGUE_NOT_FOUND",
            ref: "ef56ab78",
          })
        }
      >
        Routine error
      </Button>
    </>
  );
}

const entry: GalleryEntry = {
  name: "Toast",
  family: "feedback",
  cases: [
    { name: "Types. An error stays until it is dismissed", render: () => <Types /> },
    { name: "Four at most", render: () => <Stack /> },
    { name: "Actions", render: () => <Actions /> },
    { name: "Task", render: () => <Task /> },
    {
      name: "A backend error. Details on both, Get help beside it for an unexpected code",
      render: () => <Failures />,
    },
  ],
};

export default entry;
