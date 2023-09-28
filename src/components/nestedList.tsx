import React, { useState, useRef, useContext } from "react";
import isFunction from "lodash/isFunction";
import { makeStyles } from "../utils/makesStyles";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Collapse from "@mui/material/Collapse";
import ListItemSecondaryAction from "@mui/material/ListItemSecondaryAction";
import IconButton from "@mui/material/IconButton";
import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";

const NestedListContext = React.createContext({
  selected: "",
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setSelected: (() => {}) as (key: string) => void,
});

const useItemStyles = makeStyles<{ level?: number }>()(
  (theme, { level = 1 }) => ({
    root: {},
    nested: {
      paddingLeft: theme.spacing(3 * level) + 10,
    },
  }),
);

type NestedItemData = {
  label: string;
  children?: NestedItemData[];
};

type NestedListItemProps = {
  level: number;
  data: NestedItemData;
  onClick: (params: { label: string; level: number }) => void;
};

function NestedListItem(props: NestedListItemProps) {
  const { level, data: { label, children } = {} } = props;
  const { classes } = useItemStyles(props);
  const [open, setOpen] = useState(false);
  const { selected, setSelected } = useContext(NestedListContext);
  const key = `${level}-${label}`;

  const handleExpand = () => {
    setOpen(!open);
  };

  const handleClick = () => {
    const { onClick, data } = props;
    setSelected(key);
    if (isFunction(onClick)) {
      onClick({ ...data, level });
    }
  };

  if (Array.isArray(children) && children.length) {
    return (
      <React.Fragment>
        <ListItem
          button
          selected={selected === key}
          className={classes.nested}
          onClick={handleClick}
        >
          <ListItemText primary={label} />
          {open ? (
            <ListItemSecondaryAction>
              <IconButton onClick={handleExpand}>
                <ExpandLess fontSize="small" />
              </IconButton>
            </ListItemSecondaryAction>
          ) : (
            <ListItemSecondaryAction>
              <IconButton onClick={handleExpand}>
                <ExpandMore fontSize="small" />
              </IconButton>
            </ListItemSecondaryAction>
          )}
        </ListItem>
        <Collapse in={open} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {children.map((item, index) => (
              <NestedListItem
                key={`${level}-${index}-${item.label}`}
                data={item}
                level={level + 1}
                onClick={props.onClick}
              />
            ))}
          </List>
        </Collapse>
      </React.Fragment>
    );
  }
  return (
    <ListItem
      button
      selected={key === selected}
      className={classes.nested}
      onClick={handleClick}
    >
      <ListItemText primary={label} />
    </ListItem>
  );
}

type NestedListProps = {
  data: Array<NestedItemData>;
  onClick: (params: { label: string; level: number }) => void;
};

export function NestedList(props: NestedListProps) {
  const { data = [], onClick } = props;
  const level = useRef(0);
  const [selected, setSelected] = useState("");

  return (
    <NestedListContext.Provider value={{ selected, setSelected }}>
      <List component="nav">
        {data.map((item, index) => (
          <NestedListItem
            key={`${level.current}-${index}-${item.label}`}
            data={item}
            level={level.current}
            onClick={onClick}
          />
        ))}
      </List>
    </NestedListContext.Provider>
  );
}
