import type { NextApiHandler } from "next";
import { withSessionRoute } from "y/server/wrap";
import { asarFileDir, readAsarFile } from "y/server/service/file";
import mime from "mime-types";

const handler: NextApiHandler = async (req, res) => {
  const fileName = req.query.fileName as string;
  const filePath = (req.query.path as string[]).join("/");

  let file;
  try {
    file = await readAsarFile(asarFileDir(fileName), filePath);
  } catch (e) {
    return res.status(404).send("");
  }

  const contentType = mime.lookup(filePath);
  if (contentType) {
    res.appendHeader("Content-Type", contentType);
  }
  res.appendHeader("Cache-Control", "private,max-age=31536000,immutable");
  res.send(file);
};

export default withSessionRoute(handler);
