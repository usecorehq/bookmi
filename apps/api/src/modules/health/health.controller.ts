import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";

@ApiTags("health")
@Public()
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Liveness probe — always public." })
  check() {
    return {
      status: "ok",
      service: "bookmi-api",
      timestamp: new Date().toISOString(),
    };
  }
}
