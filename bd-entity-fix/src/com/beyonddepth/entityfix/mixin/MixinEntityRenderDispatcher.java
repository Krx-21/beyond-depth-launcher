package com.beyonddepth.entityfix.mixin;

import net.minecraft.client.renderer.culling.Frustum;
import net.minecraft.client.renderer.entity.EntityRenderDispatcher;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Adds null-check to EntityRenderDispatcher.shouldRender() to prevent NPE
 * when an entity has no registered client-side renderer (e.g. some
 * Undergarden entities).
 *
 * Without this fix, calling shouldRender() with such an entity throws:
 *   NullPointerException: Cannot invoke "EntityRenderer.shouldRender(...)"
 *   because "entityrenderer" is null
 * which crashes both the regular render pass and Oculus' shadow pass.
 */
@Mixin(EntityRenderDispatcher.class)
public abstract class MixinEntityRenderDispatcher {

    @Shadow
    public abstract <E extends Entity> EntityRenderer<? super E> m_114382_(E p_114383_);

    @Inject(method = "m_114397_", at = @At("HEAD"), cancellable = true, require = 0)
    private <E extends Entity> void bdfix_nullCheckRenderer(
            E entity, Frustum frustum, double camX, double camY, double camZ,
            CallbackInfoReturnable<Boolean> cir) {
        EntityRenderer<? super E> renderer = this.m_114382_(entity);
        if (renderer == null) {
            cir.setReturnValue(false);
        }
    }
}
