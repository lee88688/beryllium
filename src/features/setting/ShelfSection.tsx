import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { COVER_MIN, setShelfPrefs, useShelfPrefs } from "@/lib/prefs";
import {
  SettingsGroup,
  SettingsNote,
  SettingsSection,
  SettingRow,
} from "./section";

/** 「书架」：只影响呈现方式，不动文件本身。 */
export function ShelfSection() {
  const prefs = useShelfPrefs();

  return (
    <SettingsSection
      id="shelf"
      title="书架"
      description="只影响书架的呈现方式，不动文件本身。"
    >
      <SettingsGroup>
        <SettingRow
          label="封面大小"
          hint={`卡片最小宽度 ${COVER_MIN.sm} / ${COVER_MIN.md} / ${COVER_MIN.lg} px。`}
        >
          <Segmented
            aria-label="封面大小"
            value={prefs.cover}
            options={[
              { value: "sm", label: "小" },
              { value: "md", label: "中" },
              { value: "lg", label: "大" },
            ]}
            onValueChange={(cover) => setShelfPrefs({ cover })}
          />
        </SettingRow>
        <SettingRow label="默认排序" hint="打开书架时的排序方式。">
          <Segmented
            aria-label="书架默认排序"
            value={prefs.sort}
            options={[
              { value: "added", label: "最近添加" },
              { value: "title", label: "书名" },
              { value: "author", label: "作者" },
            ]}
            onValueChange={(sort) => setShelfPrefs({ sort })}
          />
        </SettingRow>
        <SettingRow
          label="顶部继续阅读卡"
          hint="书架顶部显示上次打开的那本，带「继续阅读」。"
        >
          <Switch
            aria-label="顶部继续阅读卡"
            checked={prefs.hero}
            onCheckedChange={(hero) => setShelfPrefs({ hero })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsNote>
        书架上的搜索、排序与分类筛选都是本地行为，不会改变服务端返回的顺序，也不会
        写入数据库。
      </SettingsNote>
    </SettingsSection>
  );
}
