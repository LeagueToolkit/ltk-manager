import { ClassMenubar } from "../../menus/components/ClassMenubar";
import { useObjectMenus } from "../../menus/hooks/useObjectMenus";
import { useFontPreviewMenu } from "../hooks/useAtlasCanvasMenu";
import { useAtlasMenus } from "../hooks/useAtlasMenus";

/** The menu bar of a UI view. "Menu bar" in docs/plans/atlas-ui-editor.md. */
export function AtlasMenubar() {
  const menus = useAtlasMenus("atlas");

  return <ClassMenubar menus={menus} />;
}

/** The menu bar of a UI element, a UI view's bar without what acts on the whole view. */
export function ElementMenubar() {
  const menus = useAtlasMenus("element");

  return <ClassMenubar menus={menus} />;
}

/** The menu bar of a `GameFontDescription`. */
export function FontMenubar() {
  const base = useObjectMenus();
  const preview = useFontPreviewMenu();

  return <ClassMenubar menus={[base.file(), base.edit(), base.view(), preview]} />;
}
