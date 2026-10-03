import template from '../dashboard.html';
import script from '../dashboard-client.js.txt';
import style from '../dashboard.css';
import {createAccessVerifier} from './access.mjs';
import {createHandler} from './handler.mjs';
import {renderHosted} from './render.mjs';
export default createHandler({
  authenticate:createAccessVerifier(),
  render:(input, at) => renderHosted(input, at, {template,script,style}),
});
