import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "@/components/sonner-toaster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage } from "@/lib/utils";
import { login } from "@/server/fns/session";

/** Both fields are non-empty only — same contract as the legacy Formik schema. */
const loginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

type LoginValues = z.infer<typeof loginSchema>;

/**
 * Login form. `login` answers `{ ok: false, message }` instead
 * of throwing, so a wrong password is rendered inline *and* toasted: the legacy
 * screen swallowed the failure completely.
 */
export function LoginForm() {
  const navigate = useNavigate();
  const [failure, setFailure] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFailure("");
    try {
      const result = await login({ data: values });
      if (!result.ok) {
        setFailure(result.message);
        toast.error(result.message);
        return;
      }
      await navigate({ to: "/bookshelf" });
    } catch (error) {
      const message = errorMessage(error);
      setFailure(message);
      toast.error(message);
    }
  });

  return (
    <form
      className="flex w-full max-w-xs flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="username">用户名</Label>
        <Input
          id="username"
          autoFocus
          autoComplete="username"
          disabled={isSubmitting}
          aria-invalid={errors.username ? true : undefined}
          {...register("username")}
        />
        {errors.username ? (
          <p className="text-destructive text-xs">{errors.username.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">密码</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          disabled={isSubmitting}
          aria-invalid={errors.password ? true : undefined}
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-destructive text-xs">{errors.password.message}</p>
        ) : null}
      </div>

      {failure ? (
        <p role="alert" className="text-destructive text-sm">
          {failure}
        </p>
      ) : null}

      <Button type="submit" className="mt-1" disabled={isSubmitting}>
        {isSubmitting ? <Spinner className="size-4" /> : null}
        登 陆
      </Button>
    </form>
  );
}
