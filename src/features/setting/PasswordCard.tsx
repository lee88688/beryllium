import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "@/components/sonner-toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/utils";
import { changePassword } from "@/server/fns/users";
import {
  SettingsGroup,
  SettingsNote,
  SettingsSection,
  SettingRow,
} from "./section";

/**
 * D3: the two entries must match, checked here *and* server-side
 * (`src/server/services/user.ts`). The 6-character floor mirrors that service.
 */
const passwordSchema = z
  .object({
    newPassword: z.string().min(6, "密码至少 6 位"),
    confirmPassword: z.string().min(1, "请再次输入新密码"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次输入的密码不一致",
  });

type PasswordValues = z.infer<typeof passwordSchema>;

/** 「账号」分区 (PRD §5.6)：改自己的密码。 */
export function PasswordCard() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: PasswordValues) =>
      changePassword({
        data: {
          newPassword: values.newPassword,
          confirmPassword: values.confirmPassword,
        },
      }),
    onSuccess: () => {
      toast.success("密码修改成功");
      reset();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onSubmit = handleSubmit((values) => mutation.mutate(values));

  return (
    <SettingsSection
      id="account"
      title="账号"
      description="每个账号都能改自己的密码。没有找回流程——忘记密码只能由管理员重建账号。"
    >
      <SettingsGroup>
        <SettingRow
          label="修改密码"
          hint="密码至少 6 位，两次输入必须一致；提交后新密码立即生效。"
          stack
        >
          <form
            className="flex w-full max-w-sm flex-col gap-3"
            noValidate
            onSubmit={(event) => {
              void onSubmit(event);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">新密码</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={errors.newPassword ? true : undefined}
                {...register("newPassword")}
              />
              {errors.newPassword ? (
                <p className="text-destructive text-xs">
                  {errors.newPassword.message}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">再次输入</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={errors.confirmPassword ? true : undefined}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword ? (
                <p className="text-destructive text-xs">
                  {errors.confirmPassword.message}
                </p>
              ) : null}
            </div>

            <div>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Spinner className="size-4" /> : null}
                确认
              </Button>
            </div>
          </form>
        </SettingRow>
      </SettingsGroup>
      <SettingsNote>
        改完密码当前会话仍然有效，其它设备上已登录的会话不受影响。
      </SettingsNote>
    </SettingsSection>
  );
}
