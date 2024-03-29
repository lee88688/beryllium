import React, { useState, useEffect, useMemo } from "react";
import isFunction from "lodash/isFunction";
import Paper from "@mui/material/Paper";
import Input from "@mui/material/Input";
import Divider from "@mui/material/Divider";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import { ColorRadio } from "./colorRadio";
import Button from "@mui/material/Button";
import { makeStyles } from "../utils/makesStyles";

export enum Colors {
  Red = "red",
  Purple = "purple",
  Blue = "blue",
  Cyan = "cyan",
  Teal = "teal",
  Orange = "orange",
  BlueGrey = "blue-grey",
}

const colors: Array<{ label: Colors; value: string }> = [
  { label: Colors.Red, value: "#F44336" },
  { label: Colors.Purple, value: "#9C27B0" },
  { label: Colors.Blue, value: "#2196F3" },
  { label: Colors.Cyan, value: "#00BCD4" },
  { label: Colors.Teal, value: "#009688" },
  { label: Colors.Orange, value: "#FF9800" },
  { label: Colors.BlueGrey, value: "#607D8B" },
];

const colorsMap: Record<Colors, string> = colors.reduce(
  (acc, { label, value }) => ({ ...acc, [label]: value }),
  {} as Record<Colors, string>,
);

export function getColorsValue(label: Colors) {
  return colorsMap[label];
}

type HighlightEditorProps<T extends Record<string, unknown>> = {
  id?: number;
  color: string;
  content: string;
  epubcfi: string;
  onConfirm: (params: HighlightEditorValue<T>) => void;
  onDelete: (
    params: Pick<HighlightEditorProps<T>, "color" | "content" | "epubcfi"> & T,
  ) => void;
  onCancel: (
    params: Pick<HighlightEditorProps<T>, "color" | "content">,
  ) => void;
  onChange: (
    params: Pick<HighlightEditorProps<T>, "color" | "content" | "epubcfi"> & T,
  ) => void;
};

type HighlightEditorValue<T extends Record<string, unknown>> = Pick<
  HighlightEditorProps<T>,
  "color" | "content" | "epubcfi"
> &
  T;

const useStyles = makeStyles()(() => ({
  root: {
    width: "300px",
  },
  input: {
    paddingLeft: "5px",
    paddingRight: "5px",
    "&::before": { display: "none" },
    "&::after": { display: "none" },
  },
  radioGroup: {
    paddingLeft: "11px",
    "& > label": {
      marginRight: 0,
    },
  },
  actions: {
    display: "flex",
    flexDirection: "row-reverse",
  },
}));

export function HighlightEditor<T extends Record<string, unknown>>(
  props: HighlightEditorProps<T>,
) {
  const { onChange, onCancel, onDelete, onConfirm, ...otherProps } = props;
  const { classes } = useStyles();
  const [{ color, content }, setEditorContent] = useState({
    color: "",
    content: "",
  });

  useEffect(() => {
    setEditorContent({ color: props.color, content: props.content });
  }, [props.color, props.content]);

  const onEditChange = (type: string) => {
    if (type === "color") {
      return (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditorContent({ color: e.target.value, content });
        isFunction(onChange) &&
          onChange({
            ...otherProps,
            color: e.target.value,
            content,
          } as HighlightEditorValue<T>);
      };
    } else if (type === "text") {
      return (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditorContent({ color, content: e.target.value });
        isFunction(onChange) &&
          onChange({
            ...otherProps,
            color,
            content: e.target.value,
          } as HighlightEditorValue<T>);
      };
    }
  };
  const colorRadios = useMemo(() => {
    return colors.map(({ label, value }) => (
      <FormControlLabel
        key={label}
        label=""
        value={label}
        control={<ColorRadio key={label} color={value} />}
      />
    ));
  }, []);

  return (
    <Paper className={classes.root} elevation={3}>
      <RadioGroup
        value={color}
        onChange={onEditChange("color")}
        row
        name="color"
        className={classes.radioGroup}
      >
        {colorRadios}
      </RadioGroup>
      <Divider />
      <Input
        value={content}
        onChange={onEditChange("text")}
        fullWidth
        multiline
        classes={{ root: classes.input }}
        placeholder="评论"
        disabled={!props.id}
      />
      <Divider />
      <div className={classes.actions}>
        <Button
          key="confirm"
          color="primary"
          onClick={() => {
            isFunction(onConfirm) &&
              onConfirm({
                ...otherProps,
                color,
                content,
              } as HighlightEditorValue<T>);
          }}
        >
          确定
        </Button>
        <Button
          key="delete"
          color="secondary"
          onClick={() => {
            isFunction(onDelete) &&
              onDelete({
                ...otherProps,
                color,
                content,
              } as HighlightEditorValue<T>);
          }}
        >
          删除
        </Button>
        <Button
          key="cancel"
          onClick={() => {
            isFunction(onCancel) && onCancel({ ...props, color, content });
          }}
        >
          取消
        </Button>
      </div>
    </Paper>
  );
}
