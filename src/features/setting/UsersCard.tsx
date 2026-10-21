import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrashIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  ConfirmCanceledError,
  useConfirmDialog,
} from "@/components/confirm-dialog";
import { toast } from "@/components/sonner-toaster";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorMessage } from "@/lib/utils";
import { addUser, getUsers, removeUser } from "@/server/fns/users";
import { SettingsGroup, SettingsSection, SettingRow } from "./section";

/** Server-side rules mirrored: username non-empty, password ≥ 6 (PRD §5.6). */
const newUserSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名"),
  password: z.string().min(6, "密码至少 6 位"),
});

type NewUserValues = z.infer<typeof newUserSchema>;

const USERS_QUERY_KEY = ["users"] as const;

/**
 * 「用户」分区（仅管理员，PRD §5.6）：添加新用户 + 账号列表。
 * 路由决定这个分区存不存在 —— 普通账号根本不会挂载它。
 * 管理员账号不可删除（服务端同样拒绝），因此那一行的删除按钮是禁用态而不是消失。
 */
export function UsersCard() {
  const client = useQueryClient();
  const { dialog, openDialog } = useConfirmDialog();

  const usersQuery = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: () => getUsers(),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewUserValues>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { username: "", password: "" },
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: USERS_QUERY_KEY });
  };

  const addMutation = useMutation({
    mutationFn: (values: NewUserValues) => addUser({ data: values }),
    onSuccess: () => {
      toast.success("用户已添加");
      reset();
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => removeUser({ data: { id } }),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: refresh,
  });

  const onSubmit = handleSubmit((values) => addMutation.mutate(values));

  const handleRemove = async (user: { id: number; username: string }) => {
    try {
      await openDialog({
        title: "删除用户",
        content: `是否删除${user.username}?`,
      });
    } catch (error) {
      if (error instanceof ConfirmCanceledError) return;
      throw error;
    }
    removeMutation.mutate(user.id);
  };

  const users = usersQuery.data ?? [];
  const admins = users.filter((user) => user.isAdmin).length;

  return (
    <SettingsSection
      id="users"
      title="用户"
      description="每个账号都是「管理员」或「普通用户」两种之一：管理员能管理用户，普通用户只能读书与做标记。"
    >
      <SettingsGroup>
        <SettingRow
          label="添加新用户"
          hint="用户名不能重复；密码至少 6 位，添加后由本人在「账号」里修改。"
          stack
        >
          <form
            className="flex flex-wrap items-end gap-3"
            noValidate
            onSubmit={(event) => {
              void onSubmit(event);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-username">用户名</Label>
              <Input
                id="new-username"
                aria-invalid={errors.username ? true : undefined}
                {...register("username")}
              />
              {errors.username ? (
                <p className="text-destructive text-xs">
                  {errors.username.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-user-password">密码</Label>
              <Input
                id="new-user-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={errors.password ? true : undefined}
                {...register("password")}
              />
              {errors.password ? (
                <p className="text-destructive text-xs">
                  {errors.password.message}
                </p>
              ) : null}
            </div>
            <Button type="submit" disabled={addMutation.isPending}>
              {addMutation.isPending ? <Spinner className="size-4" /> : null}
              新增
            </Button>
          </form>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        caption={
          usersQuery.isSuccess
            ? `账号 ${users.length} · 管理员 ${admins} · 普通用户 ${users.length - admins}`
            : undefined
        }
      >
        {usersQuery.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : usersQuery.isError ? (
          <p className="text-destructive py-3 text-base" role="alert">
            {errorMessage(usersQuery.error)}
          </p>
        ) : (
          <Table aria-label="user table">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>用户名称</TableHead>
                <TableHead className="w-24">管理员</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id} className="border-line">
                  <TableCell className="text-muted-foreground tabular-nums">
                    {user.id}
                  </TableCell>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>
                    {user.isAdmin ? (
                      <span className="bg-hover text-muted-foreground inline-flex h-5 items-center rounded-full px-2 text-xs">
                        管理员
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <IconButton
                      size="sm"
                      aria-label={`删除用户 ${user.username}`}
                      aria-disabled={user.isAdmin ? true : undefined}
                      title={user.isAdmin ? "管理员账号不能删除" : undefined}
                      className={
                        user.isAdmin
                          ? "pointer-events-none opacity-30"
                          : "text-muted-foreground hover:text-destructive"
                      }
                      onClick={() => {
                        void handleRemove(user);
                      }}
                    >
                      <TrashIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SettingsGroup>
      {dialog}
    </SettingsSection>
  );
}
