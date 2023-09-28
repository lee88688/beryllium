import React, { useState, useMemo } from "react";
import Box from "@mui/material/Box";
import { makeStyles } from "y/utils/makesStyles";
import AppBar from "@mui/material/AppBar";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
// import TabPanel from "@mui/material/TabPanel";
import { NestedList } from "y/components/nestedList";
import Hidden from "@mui/material/Hidden";
import SwipeableDrawer from "@mui/material/SwipeableDrawer";
import Drawer from "@mui/material/Drawer";
import { useRendered } from "../../hooks/useRendered";
import { HighlightList } from "y/components/highlightList";
import { BookmarkList } from "y/components/bookmarkList";
import type * as Prisma from "@prisma/client";

type TabPanelProps = {
  children: React.ReactNode;
  index: number;
  value: number;
  className: string;
};

function TabPanel(props: TabPanelProps) {
  const { children, value, index, className } = props;
  const [rendered, curState] = useRendered(value === index);

  return (
    <div
      className={className}
      role="tabpanel"
      hidden={!curState}
      style={{ display: !curState ? "none" : "block" }}
      id={`full-width-tabpanel-${index}`}
      aria-labelledby={`full-width-tab-${index}`}
    >
      {rendered && <Box p={0}>{children}</Box>}
    </div>
  );
}

export const drawerWidth = 340;
export const viewBreakPoint = "sm";

const useDrawerStyles = makeStyles()((theme) => ({
  root: {
    [theme.breakpoints.up(viewBreakPoint)]: {
      width: drawerWidth,
      flexShrink: 0,
    },
  },
  drawerPaper: {
    width: drawerWidth,
  },
  drawer: {
    maxHeight: "100%;",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  appBar: {
    flexShrink: 0,
  },
  tabPanel: {
    flexGrow: 1,
    overflow: "auto",
  },
  tab: {
    minWidth: 0,
  },
}));

type ReaderDrawerProps = {
  id: string;
  tocData: any[];
  bookmarks: Prisma.Mark[];
  highlights: Prisma.Mark[];
  onClickToc: () => void;
  onClickHighlight: (params: { epubcfi: string }) => void;
  onRemoveMark: (mark: Prisma.Mark) => void;
};

export function ReaderDrawer(props: ReaderDrawerProps) {
  const {
    tocData,
    bookmarks,
    highlights,
    onClickToc,
    onClickHighlight,
    onRemoveMark,
  } = props;

  const [tabIndex, setTabIndex] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { classes } = useDrawerStyles();

  const tocItem = useMemo(
    () => <NestedList data={tocData} onClick={onClickToc} />,
    [tocData, onClickToc],
  );

  const container =
    typeof window !== undefined ? () => window.document.body : undefined;

  const drawer = (
    <div className={classes.drawer}>
      <AppBar className={classes.appBar} position="static" color="default">
        <Tabs
          value={tabIndex}
          onChange={(_, index: number) => setTabIndex(index)}
          indicatorColor="primary"
          textColor="primary"
          variant="fullWidth"
        >
          <Tab label="目录" classes={{ root: classes.tab }} />
          <Tab label="备注" classes={{ root: classes.tab }} />
          <Tab label="书签" classes={{ root: classes.tab }} />
        </Tabs>
      </AppBar>
      <TabPanel className={classes.tabPanel} value={tabIndex} index={0}>
        {tocItem}
      </TabPanel>
      <TabPanel className={classes.tabPanel} value={tabIndex} index={1}>
        <HighlightList
          highlightList={highlights}
          onClick={onClickHighlight}
          onRemoveMark={onRemoveMark}
        />
      </TabPanel>
      <TabPanel className={classes.tabPanel} value={tabIndex} index={2}>
        <BookmarkList
          bookmarkList={bookmarks}
          onClick={onClickHighlight}
          onRemove={onRemoveMark}
        />
      </TabPanel>
    </div>
  );

  return (
    <nav className={classes.root} aria-label="mailbox folders">
      {/* The implementation can be swapped with js to avoid SEO duplication of links. */}
      <Hidden smUp>
        <SwipeableDrawer
          container={container}
          variant="temporary"
          anchor="right"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          onOpen={() => setMobileOpen(true)}
          classes={{
            paper: classes.drawerPaper,
          }}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
        >
          {drawer}
        </SwipeableDrawer>
      </Hidden>
      <Hidden xsDown>
        <Drawer
          classes={{
            paper: classes.drawerPaper,
          }}
          anchor="right"
          variant="permanent"
          open
        >
          {drawer}
        </Drawer>
      </Hidden>
    </nav>
  );
}
