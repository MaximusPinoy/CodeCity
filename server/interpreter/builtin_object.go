/* Copyright 2017 Google Inc.
 * https://github.com/NeilFraser/CodeCity
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package interpreter

import (
	"CodeCity/server/interpreter/data"
)

func (intrp *Interpreter) initBuiltinObject() {
	intrp.mkBuiltin("Object", data.NewObject(nil, intrp.protos.ObjectProto))
	intrp.mkBuiltin("Object.prototype", intrp.protos.ObjectProto)
	intrp.mkBuiltinFunc("Object.prototype.toString", 0,
		func(intrp *Interpreter, this data.Value, args []data.Value) (ret data.Value, throw bool) {
			return this.ToString(), false
		})
}
