import React, { useState, useMemo } from "react";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import IconButton from "@mui/material/IconButton";
import MenuIcon from "@mui/icons-material/Menu";
import Typography from "@mui/material/Typography";
import { Box } from "@mui/material";
import {
  apiAddBooksToCategory,
  apiDeleteBook,
  apiGetBook,
  apiGetCategory,
  apiRemoveBooksFromCategory,
  uploadBook,
} from "../clientApi";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import MoreVert from "@mui/icons-material/MoreVert";
import type * as Prisma from "@prisma/client";
import { apiRemoveCategory } from "../clientApi";
import { type GetServerSideProps } from "next";
import { prisma } from "y/server/db";
import { withSessionSsr } from "y/config";
import { useSnackbar } from "notistack";
import { makeStyles } from "../../utils/makesStyles";
import { useQuery } from "@tanstack/react-query";
import { BookList } from "./bookList";
import { BookshelfDrawer } from "./drawer";

export const drawerWidth = 300;

export interface BookshelfProps {
  books: Prisma.Book[];
  categories: (Prisma.Category & {
    categoryBook: (Prisma.CategoryBook & { book: Prisma.Book })[];
  })[];
}

const useStyles = makeStyles()((theme) => ({
  root: {
    display: "flex",
  },
  appBar: {
    [theme.breakpoints.up("sm")]: {
      width: `calc(100% - ${drawerWidth}px)`,
      marginLeft: drawerWidth,
    },
  },
  sidebarButton: {
    marginRight: theme.spacing(2),
    [theme.breakpoints.up("sm")]: {
      display: "none",
    },
  },
  appBarTitle: {
    flexGrow: 1,
  },
  menuButton: {},
  content: {
    flexGrow: 1,
    padding: `${theme.spacing(3)}px 0`,
  },
}));

export default function Bookshelf(props: BookshelfProps) {
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement>();
  const { enqueueSnackbar } = useSnackbar();

  const { classes } = useStyles();

  const categoryQuery = useQuery({
    queryKey: ["getCategory"] as const,
    queryFn: () => apiGetCategory().then((res) => res.data),
    initialData: props.categories,
  });

  const bookQuery = useQuery({
    queryKey: ["getBook"],
    queryFn: () => apiGetBook().then((res) => res.data),
    initialData: props.books,
  });

  const categories = categoryQuery.data;

  const books = useMemo(() => {
    if (selectedCategory) {
      return (
        categories
          .find((item) => item.id === selectedCategory)
          ?.categoryBook.map((item) => item.book) ?? []
      );
    }

    return props.books;
  }, [categories, props.books, selectedCategory]);

  const menuClose = () => setMenuAnchor(undefined);
  const menuOpen: React.MouseEventHandler<HTMLButtonElement> = (e) =>
    setMenuAnchor(e.currentTarget as HTMLButtonElement);
  const handleRemoveCategory = () => {
    menuClose();
    apiRemoveCategory({ id: selectedCategory });
    // dispatch(setCategoryAndGetBooks(null));
    // dispatch(getCategories());
    enqueueSnackbar("删除成功", { variant: "success" });
  };

  const handleSelectFile = async (file: File) => {
    await uploadBook(file);
    // dispatch(getBooks());
    enqueueSnackbar("successful upload", { variant: "success" });
  };

  const handleAddBooksToCategory = async (
    params: { categoryId: number; bookId: number }[],
  ) => {
    await apiAddBooksToCategory(params);
    enqueueSnackbar("add successful", { variant: "success" });
    await categoryQuery.refetch();
  };

  const handleRemoveBooksFromCategory = async (
    categoryId: number,
    bookId: number,
  ) => {
    await apiRemoveBooksFromCategory(categoryId, [bookId]);
    // dispatch(getBooks());
    enqueueSnackbar("移除成功", { variant: "success" });
    await categoryQuery.refetch();
  };

  const handleDeleteBook = async (bookId: number) => {
    await apiDeleteBook({ id: bookId });
    // dispatch(getBooks());
    enqueueSnackbar("删除成功", { variant: "success" });
    await Promise.all([categoryQuery.refetch(), bookQuery.refetch()]);
  };

  const menuButton = !selectedCategory ? null : (
    <IconButton
      color="inherit"
      aria-label="open menu"
      edge="end"
      onClick={menuOpen}
    >
      <MoreVert />
    </IconButton>
  );

  return (
    <Box className={classes.root}>
      <AppBar component={"nav"} className={classes.appBar}>
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            className={classes.sidebarButton}
            onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
          >
            <MenuIcon />
          </IconButton>
          <Typography className={classes.appBarTitle} variant="h6" noWrap>
            Bookshelf
          </Typography>
          {menuButton}
          <Menu
            open={Boolean(menuAnchor)}
            anchorEl={menuAnchor}
            onClose={menuClose}
          >
            <MenuItem onClick={handleRemoveCategory}>删除类别</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      {/* {drawerItem} */}
      <BookshelfDrawer
        mobileOpen={mobileDrawerOpen}
        selected={selectedCategory}
        onSelected={setSelectedCategory}
        categories={props.categories}
        onMobileOpenChange={setMobileDrawerOpen}
      />
      <Box component={"main"} className={classes.content}>
        <Toolbar />
        <BookList
          categories={categories}
          books={books}
          selected={selectedCategory}
          onSelectFile={handleSelectFile}
          onAddBooksToCategory={handleAddBooksToCategory}
          onRemoveBooksFromCategory={handleRemoveBooksFromCategory}
          onDeleteBook={handleDeleteBook}
        />
      </Box>
    </Box>
  );
}

export const getServerSideProps: GetServerSideProps<BookshelfProps> =
  withSessionSsr(async ({ req }) => {
    const user = req.session.user;

    const books = await prisma.book.findMany({ where: { userId: user.id } });

    const categories = await prisma.category.findMany({
      where: {
        userId: user.id,
      },
      include: {
        categoryBook: {
          include: {
            book: true,
          },
        },
      },
    });

    return {
      props: { books, categories },
    };
  });