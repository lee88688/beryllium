"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";
import { useFormik } from "formik";
import { toFormikValidationSchema } from "zod-formik-adapter";
import { z } from "zod";
import { loginAction } from "y/app/login/actions";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export default function Page() {
  const router = useRouter();

  const formik = useFormik({
    initialValues: {
      username: "",
      password: "",
    },
    validationSchema: toFormikValidationSchema(loginSchema),
    async onSubmit({ username, password }) {
      await loginAction({ username, password });
      return router.push("/bookshelf");
    },
  });

  useEffect(() => {
    void router.prefetch("/bookshelf");
  }, [router]);

  return (
    <Container
      component="main"
      maxWidth="xs"
      sx={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "20vh",
      }}
    >
      <Typography component="h1" variant="h5">
        用户登陆
      </Typography>
      <form className="mt-2 w-full" noValidate>
        <TextField
          value={formik.values.username}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
          error={Boolean(formik.errors.username) && formik.touched.username}
          helperText={formik.touched.username && formik.errors.username}
          variant="outlined"
          margin="normal"
          required
          fullWidth
          name="username"
          label="用户名"
          autoFocus
          disabled={formik.isSubmitting}
        />
        <TextField
          value={formik.values.password}
          onChange={formik.handleChange}
          onBlur={formik.handleBlur}
          error={Boolean(formik.errors.password) && formik.touched.password}
          helperText={formik.touched.password && formik.errors.password}
          variant="outlined"
          margin="normal"
          required
          fullWidth
          name="password"
          label="密码"
          type="password"
          id="password"
          autoComplete="current-password"
          disabled={formik.isSubmitting}
        />
        <Button
          fullWidth
          variant="contained"
          color="primary"
          sx={{ mt: 2 }}
          disabled={!formik.isValid}
          onClick={() => formik.handleSubmit()}
        >
          登 陆
        </Button>
      </form>
    </Container>
  );
}
