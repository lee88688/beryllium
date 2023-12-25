import { type AddBooksToCategoryParams } from "./pages/api/category/addBooks";

import { post, get } from "y/utils/request";
import { type CreateCategoryParam } from "./pages/api/category/create";
import { type RemoveCategoryParam } from "./pages/api/category/remove";
import { type LoginParam } from "./pages/api/user/login";
import { type DeleteBookParam } from "./pages/api/book/destroy";
import { type CreateMarkParams } from "./pages/api/mark/create";
import { type GetMarkQuery } from "./pages/api/mark";
import { type UpdateMarkParams } from "./pages/api/mark/update";
import type * as Prisma from "@prisma/client";
import { type CreateUserParams } from "./pages/api/user/create";
import { type DeleteUserParams } from "./pages/api/user/destroy";
import { type PasswordParams } from "./pages/api/user/password";

export function apiAddBooksToCategory(data: AddBooksToCategoryParams[]) {
  return post("/api/category/addBooks", data);
}

export function apiCreateCategory(data: CreateCategoryParam) {
  return post("/api/category/create", data);
}

export function apiRemoveCategory(data: RemoveCategoryParam) {
  return post("/api/category/remove", data);
}

export function apiGetCategory() {
  return get<
    (Prisma.Category & {
      categoryBook: (Prisma.CategoryBook & { book: Prisma.Book })[];
    })[]
  >("/api/category");
}

export function apiRemoveBooksFromCategory(
  categoryId: number,
  bookIds: number[],
) {
  return post("/api/category/removeBooks", bookIds);
}

export function apiLogin(form: LoginParam) {
  return post("/api/user/login", form);
}

export function apiLogout() {
  return post("/api/user/logout");
}

export function apiDeleteBook(param: DeleteBookParam) {
  return post("/api/book/destroy", param);
}

export function apiGetBookCurrent(id: number | string) {
  return get<string>(`/api/book/${id}`);
}

export function apiUpdateBookCurrent(id: number | string, epubcfi: string) {
  return post(`/api/book/${id}/update`, { current: epubcfi });
}

export function uploadBook(file: File) {
  const form = new FormData();
  form.append("file", file);
  return post("/api/book/create", form);
}

export function apiGetBook() {
  return get<Prisma.Book[]>(`/api/book`);
}

export function getMark(query: GetMarkQuery) {
  return get<Prisma.Mark[]>("/api/mark", query);
}

export function addMark(params: CreateMarkParams) {
  return post<number>("/api/mark/create", params);
}

export function removeMark(id: number) {
  return post("/api/mark/destroy", { id });
}

export function apiUpdateMark(params: UpdateMarkParams) {
  return post("/api/mark/update", params);
}

export function getFileUrl(fileName: string, path: string) {
  return `/api/book/file/${fileName}/${path}`;
}

export function apiCreateUser(user: CreateUserParams) {
  return post("/api/user/create", user);
}

export function apiDeleteUser(params: DeleteUserParams) {
  return post("/api/user/destroy", params);
}

export function apiChangePassword(params: PasswordParams) {
  return post("/api/user/password", params);
}

export function apiUserList() {
  return get<Pick<Prisma.User, "id" | "username" | "isAdmin">[]>(
    "/api/user/list",
  );
}